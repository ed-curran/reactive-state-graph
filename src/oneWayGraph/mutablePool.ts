import { mergePatch } from './mergePatch';
import { DiscriminatedEntityWithId } from '../core/model';
import {
  discriminatedEntityId,
  discriminatedModelParser,
  hasId,
  InferPoolEntity,
  InferPoolEntityWithId,
  InferPoolMutation,
  InferPoolRootEntity,
  PoolOptions,
  PoolSchemaAny,
  PoolState,
} from '../core/pool';

// interface PoolState<S extends DiscriminatedEntityWithId> {
//   get(name: S['name'], id: string): S | undefined;
//   set(discriminatedEntity: S): void;
//   delete(name: S['name'], id: string): void;
//   snapshot(): S[];
// }

export class MutablePoolState<S extends DiscriminatedEntityWithId>
  implements PoolState<S>
{
  private entities: Map<S['name'], S>;
  constructor() {
    this.entities = new Map();
  }

  get(name: S['name'], id: string): S | undefined {
    const discriminatedEntity = this.entities.get(
      discriminatedEntityId(name, id),
    );
    return discriminatedEntity && discriminatedEntity.name === name
      ? discriminatedEntity
      : undefined;
  }

  set(discriminatedEntity: S) {
    this.entities.set(
      discriminatedEntityId(
        discriminatedEntity.name,
        discriminatedEntity.entity.id,
      ),
      discriminatedEntity,
    );
    return discriminatedEntity;
  }
  delete(name: S['name'], id: string) {
    this.entities.delete(discriminatedEntityId(name, id));
  }
  snapshot(): S[] {
    const snapshot = new Array<S>();
    this.entities.forEach((entity) => {
      snapshot.push(entity);
    });
    return snapshot;
  }
}

export class MutablePool<S extends PoolSchemaAny> {
  private rootState: InferPoolRootEntity<S> | undefined;
  private state: MutablePoolState<InferPoolEntityWithId<S>>;
  private schema: S;
  private options: PoolOptions<S, MutablePoolState<InferPoolEntityWithId<S>>> &
    Required<
      Pick<
        PoolOptions<S, PoolState<InferPoolEntityWithId<S>>>,
        'merge' | 'parse'
      >
    >;

  constructor(
    schema: S,
    options?: PoolOptions<S, MutablePoolState<InferPoolEntityWithId<S>>>,
    poolState?: MutablePoolState<InferPoolEntityWithId<S>>,
  ) {
    this.schema = schema;
    this.rootState = undefined;
    this.state = poolState ?? new MutablePoolState<InferPoolEntityWithId<S>>();
    this.options = {
      parse: discriminatedModelParser(schema),
      merge: mergePatch,
      ...options,
    };
  }

  createEntity(
    entity: InferPoolEntityWithId<S>,
  ): InferPoolEntityWithId<S>['entity'] {
    //ugly
    this.apply([
      {
        operation: 'Create',
        name: entity.name,
        entity: entity.entity,
      },
    ]);
    return this.state.get(entity.name, entity.entity.id)!.entity;
  }

  private getApplyMutation(
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
            if (mutation.name === this.schema.rootModel.name) {
              this.rootState = discriminatedEntity.entity;
            }
            //at some po
            this.state.set(discriminatedEntity);
            this.options?.onMutation?.create?.(
              this.state,
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
            this.options?.onMutation?.update?.(this.state, entity, mutation);
            //pretty sure this doesn't mutate mutation.entity
            //but does mutate our original entity
            this.options.merge(entity, mutation.entity);
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
            this.options?.onMutation?.delete?.(this.state, entity, mutation);
            this.state.delete(mutation.name, mutation.entity.id);
          };
        }
        break;
      }
    }
    return undefined;
  }

  apply(transaction: InferPoolMutation<S>[]): void {
    const applyMutations: (() => void)[] = [];
    for (const mutation of transaction) {
      const entity = hasId(mutation.entity)
        ? this.state.get(mutation.name, mutation.entity.id)
        : undefined;
      const applyMutation = this.getApplyMutation(mutation, entity);
      if (applyMutation !== undefined) applyMutations.push(applyMutation);
    }
    if (this.options.onTransaction) {
      //caller can choose how to apply the mutations
      this.options.onTransaction(applyMutations);
    } else {
      //we'll apply the mutations instead
      for (const applyMutation of applyMutations) {
        applyMutation();
      }
    }
  }

  getState(): PoolState<InferPoolEntityWithId<S>> {
    return this.state;
  }

  createRoot(
    root: InferPoolRootEntity<S>,
    entities: InferPoolEntity<S>[],
  ): InferPoolRootEntity<S> {
    this.apply(
      [{ name: this.schema.rootModel.name, entity: root }, ...entities].map(
        (entity) => ({
          operation: 'Create',
          name: entity.name,
          entity: entity.entity,
        }),
      ),
    );

    return this.rootState as InferPoolRootEntity<S>;
  }

  getRoot(): InferPoolRootEntity<S> | undefined {
    return this.rootState;
  }
}

export const mutablePool = function <S extends PoolSchemaAny>(
  schema: S,
  options?: PoolOptions<S, MutablePoolState<InferPoolEntityWithId<S>>>,
) {
  return new MutablePool(schema, options);
};
