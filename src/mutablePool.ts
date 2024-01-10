import { mergePatch } from './mergePatch';
import { InferDiscriminatedEntity, InferEntity } from './core/model';
import {
  CreateMutation,
  DeleteMutation,
  discriminatedEntityId,
  DiscriminatedEntityParser,
  discriminatedModelParser,
  hasId,
  InferPoolEntity,
  InferPoolEntityName,
  InferPoolEntityWithId,
  InferPoolModel,
  InferPoolMutation,
  Pool,
  PoolFactory,
  PoolSchemaAny,
  PoolState,
  UpdateMutation,
} from './core/pool';

class MutablePoolState<S extends PoolSchemaAny> implements PoolState<S> {
  private entities: Map<InferPoolEntityName<S>, InferPoolEntityWithId<S>>;
  constructor() {
    this.entities = new Map();
  }

  get(
    name: InferPoolEntityName<S>,
    id: string,
  ): InferPoolEntityWithId<S> | undefined {
    const discriminatedEntity = this.entities.get(
      discriminatedEntityId(name, id),
    );
    return discriminatedEntity && discriminatedEntity.name === name
      ? discriminatedEntity
      : undefined;
  }

  set(discriminatedEntity: InferPoolEntityWithId<S>) {
    this.entities.set(
      discriminatedEntityId(
        discriminatedEntity.name,
        discriminatedEntity.entity.id,
      ),
      discriminatedEntity,
    );
  }
  delete(name: InferPoolEntityName<S>, id: string) {
    this.entities.delete(discriminatedEntityId(name, id));
  }
  snapshot(): InferPoolEntity<S>[] {
    const snapshot = new Array<InferPoolEntity<S>>();
    this.entities.forEach((entity) => {
      snapshot.push(entity);
    });
    return snapshot;
  }
}

interface MutationHandler<S extends PoolSchemaAny> {
  create?: (
    state: PoolState<S>,
    //this is the entity we're about to create
    discriminatedEntity: InferPoolEntityWithId<S>,
    mutation: CreateMutation<InferPoolModel<S>>,
  ) => void;
  update?: (
    state: PoolState<S>,
    //this is the entity we're about to update but
    discriminatedEntity: InferPoolEntityWithId<S>,
    mutation: UpdateMutation<InferPoolModel<S>>,
  ) => void;
  delete?: (
    state: PoolState<S>,
    //this is the entity we're about to delete
    discriminatedEntity: InferPoolEntityWithId<S>,
    mutation: DeleteMutation<InferPoolModel<S>>,
  ) => void;
}

export function mutableEntityPool<S extends PoolSchemaAny>(
  schema: S,
  options?: {
    parse?: DiscriminatedEntityParser<InferPoolEntity<S>>;
    onMutation?: MutationHandler<S>;
    onTransaction?: (applyMutations: (() => void)[]) => void;
    merge?: (entity: InferPoolEntity<S>['entity'], patch: any) => void; //this expects a mutable merge...
  },
): PoolFactory<S> {
  const optionsOrDefault = {
    parse: discriminatedModelParser(schema),
    merge: mergePatch,
    ...options,
  };
  //the typing in here gets pretty rough
  //maybe i should type things as unknown in here

  //probably most efficient would be an array indexed by a map
  //and handle deletions by filling the gap with the tail
  //because the order of elements in the pool shouldn't matter
  //(or get fancier and keep track of holes to skip over and fill in)
  //AKA classic entity pool data structure in game engines
  let root: InferEntity<S['rootModel']> | undefined = undefined;
  const state = new MutablePoolState<S>();

  function getApplyMutation(
    mutation: InferPoolMutation<S>,
    entity: InferPoolEntityWithId<S> | undefined,
  ): (() => void) | undefined {
    switch (mutation.operation) {
      case 'Create': {
        if (entity) {
          console.log('got create for entity which already exists, ignoring');
          break;
        }

        if (hasId(mutation.entity)) {
          const discriminatedEntity: InferPoolEntityWithId<S> = {
            name: mutation.name,
            //at some point we need to clone the mutation before turning it into the entity, doing it here for now. we may want to do it earlier
            //and have the transaction manager deal with validation and cloning etc
            entity: structuredClone(mutation.entity),
          };

          return () => {
            if (mutation.name === schema.rootModel.name) {
              root = discriminatedEntity;
            }
            //at some po
            state.set(discriminatedEntity);
            optionsOrDefault?.onMutation?.create?.(
              state,
              discriminatedEntity,
              mutation,
            );
          };
        }
        return;
      }
      case 'Update': {
        if (!entity) {
          console.log('got update for entity which does not exist, ignoring');
          break;
        }
        if (hasId(mutation.entity)) {
          return () => {
            optionsOrDefault?.onMutation?.update?.(state, entity, mutation);
            //pretty sure this doesn't mutate mutation.entity
            //but does mutate our original entity
            optionsOrDefault.merge(entity, mutation.entity);
          };
        }
        break;
      }
      case 'Delete': {
        if (!entity) {
          console.log('got update for entity which does not exist, ignoring');
          break;
        }
        if (hasId(mutation.entity)) {
          return () => {
            optionsOrDefault?.onMutation?.delete?.(state, entity, mutation);
            state.delete(mutation.name, mutation.entity.id);
          };
        }
        break;
      }
    }
    return undefined;
  }

  function apply(transaction: InferPoolMutation<S>[]) {
    const applyMutations: (() => void)[] = [];
    for (const mutation of transaction) {
      const entity = hasId(mutation.entity)
        ? state.get(mutation.name, mutation.entity.id)
        : undefined;
      const applyMutation = getApplyMutation(mutation, entity);
      if (applyMutation !== undefined) applyMutations.push(applyMutation);
    }
    if (optionsOrDefault.onTransaction) {
      //caller can choose how to apply the mutations
      optionsOrDefault.onTransaction(applyMutations);
    } else {
      //we'll apply the mutations instead
      for (const applyMutation of applyMutations) {
        applyMutation();
      }
    }
  }

  //todo: create transaction queue thingy
  //we assume transactions have already been parsed and deduped etc at this point
  const emptyPool: Pool<S, undefined> = {
    root: undefined,
    parse: optionsOrDefault.parse,
    state: state,
    apply,
  };

  return {
    create: (snapshotRoot, entities) => {
      emptyPool.apply(
        [
          { name: schema.rootModel.name, entity: snapshotRoot },
          ...entities,
        ].map((entity) => ({
          operation: 'Create',
          name: entity.name,
          entity: entity.entity,
        })),
      );

      return {
        ...emptyPool,
        root: (root as InferDiscriminatedEntity<S['rootModel']>).entity, //hmm we know this is undefined because we applied it to the pool, but this is pretty sketch
      };
    },
    empty: () => ({
      ...emptyPool,
      root: undefined,
    }),
  };
}
