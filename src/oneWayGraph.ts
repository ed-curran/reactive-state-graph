import {
  InferPoolEntity,
  InferPoolEntityWithId,
  Pool,
  PoolFactory,
} from './core/pool';
import { mutableEntityPool } from './mutablePool';
import { InferEntity, InferView } from './core/model';
import {
  GraphSchemaAny,
  InferGraphRootResolvedEntity,
  InferGraphView,
} from './core/graph';

interface Graph<
  S extends GraphSchemaAny,
  R extends InferGraphRootResolvedEntity<S> | undefined,
> {
  root: R;
  pool: Pool<S['poolSchema'], InferEntity<S['rootView']['model']>>;
}
export function oneWayGraph<S extends GraphSchemaAny>(
  schema: S,
  poolFactory?: PoolFactory<S['poolSchema']>,
) {
  const viewMap: Map<
    InferGraphView<S>['model']['name'],
    InferGraphView<S>
  > = new Map(
    [schema.rootView, ...schema.views].map((view) => [view.model.name, view]),
  );
  //idk why the typing here is fucked
  const poolFactoryOrDefault: PoolFactory<S['poolSchema']> =
    poolFactory ??
    mutableEntityPool(schema.poolSchema, {
      onMutation: {
        create(state, discriminatedEntity, mutation) {
          console.log(discriminatedEntity);
          const view = viewMap.get(mutation.name);
          if (!view) return;
          const sourceEntity = discriminatedEntity.entity;
          if (view.outgoingRelations) {
            for (const outgoingRelation of view.outgoingRelations) {
              //this is an outgoing relation we need to potentially do 2 things:
              //1. if source.materializedAs is set then materialize the target on the our end (the source end)
              //2. if target.field (should be called materializedAs too) is set, then materialize ourselves on to the target end
              //we need to do 1
              // really we should also check that the view of the target model includes this relation but i'm gunno skip that for now
              //how we do that differs depending on the whether its one-to-one, on-to-many or many-to-one
              const targetModelName = outgoingRelation.target.model.name;

              if (outgoingRelation.source.materializedAs) {
              }

              if (outgoingRelation.source.type === 'single') {
                //our target entity is a single entity
                //it seems sketch not doing runtime validation here but i think we can already rely on that to have happened
                const targetId = sourceEntity[
                  outgoingRelation.source.field
                ] as string;
                const targetEntity = state.get(targetModelName, targetId)
                  ?.entity;

                //if we don't find the target entity we can exit early
                if (!targetEntity) {
                  //we warn this relation is violated
                  console.log(
                    `could not create relation for target that does not exist: sourceId=${mutation.entity.id}, sourceField=${outgoingRelation.source.field}, targetId=${targetId}`,
                  );
                  break;
                }

                if (outgoingRelation.source.materializedAs) {
                  //materialise source single

                  //want to materialise the target into source
                  const materializedAs = outgoingRelation.source.materializedAs;
                  sourceEntity[materializedAs] = targetEntity;
                }
                if (outgoingRelation.target.field) {
                  //want to materialise source onto target
                  //how we do this depends on whether the target is a single or collection

                  if (outgoingRelation.target.type === 'single') {
                    //materialise target single

                    //one to one
                    targetEntity[outgoingRelation.target.field] = sourceEntity;
                  } else if (outgoingRelation.target.type === 'collection') {
                    //materialize target collection

                    //many to one
                    //we have to push source into an array
                    //todo: probably do some validation?
                    (targetEntity[outgoingRelation.target.field] as any[]).push(
                      sourceEntity,
                    );
                  }
                }

                //its possible that this relation exists but is not materialised on either end, this is fine.
              } else if (outgoingRelation.source.type === 'collection') {
                if (outgoingRelation.target.type === 'collection') {
                  console.log(`many to many relation is not supported`);
                  break;
                }
                //this must be one to many because many to many doesn't exist
                const materializedEntities = new Array<any>();
                const targetIds = sourceEntity[
                  outgoingRelation.source.field
                ] as string[];

                for (const targetId of targetIds) {
                  const targetEntity = state.get(targetModelName, targetId)
                    ?.entity;
                  if (!targetEntity) {
                    console.log(
                      `failed tried to create relation for target that does not exist: sourceId=${mutation.entity.id}, 
                      sourceField=${outgoingRelation.source.field}, targetId=${targetId}`,
                    );
                    break;
                  }
                  //there's a way to optimise this to check these conditions only once outside the loop
                  //and then call a different loop for each combination but cba
                  if (outgoingRelation.source.materializedAs) {
                    materializedEntities.push(targetEntity);
                  }
                  if (outgoingRelation.target.field) {
                    //materialise target

                    //many to many doesn't exist so we know target field is a single entity
                    targetEntity[outgoingRelation.target.field] = sourceEntity;
                  }
                }

                if (outgoingRelation.source.materializedAs) {
                  //materialise source collection
                  sourceEntity[outgoingRelation.source.materializedAs] =
                    materializedEntities;
                }
              }

              //materialize target on to our end. that means:
              //create a field called materializedAs and set its value to either an array of entities or a single entity
              //depending on the source type of the relation

              //we have to treat all three permutations differently
            }
          }
          if (view.incomingRelations) {
            for (const incomingRelation of view.incomingRelations) {
              if (!incomingRelation.target.field) break;

              //its the responsibility of the source of the incoming relation to add themselves to us (the target)
              //but we can help them out by initialising the target field for them
              if (incomingRelation.target.type === 'single') {
                sourceEntity[incomingRelation.target.field] = undefined; //would we want to use null for an empty reference?
              } else {
                sourceEntity[incomingRelation.target.field] = new Array<any>();
              }
            }
          }
        },
        update(state, discriminatedEntity, mutation) {
          //check whether any of our relation fields have been updated. if they have do a delete and a create
        },
        delete(state, discriminatedEntity, mutation) {
          //we need to remove ourselves from the target of any outgoing relations we have
          const view = viewMap.get(mutation.name);
          if (!view) return;
          const sourceEntity = discriminatedEntity.entity;
          //there's probably some common functionality with create that we could factor out
          //aka something that loops through relations and calls different handlers when a valid target is found
          if (view.outgoingRelations) {
            for (const outgoingRelation of view.outgoingRelations) {
              if (!outgoingRelation.target.field) break;
              const targetModelName = outgoingRelation.target.model.name;
              const targetField = outgoingRelation.target.field;

              if (outgoingRelation.source.type === 'single') {
                const targetId = sourceEntity[
                  outgoingRelation.source.field
                ] as string;
                const targetEntity = state.get(targetModelName, targetId)
                  ?.entity;

                //if we don't find the target entity we can exit early
                if (!targetEntity) {
                  //we warn this relation is violated
                  console.log(
                    `could not delete relation for target that does not exist: sourceId=${mutation.entity.id}, sourceField=${outgoingRelation.source.field}, targetId=${targetId}`,
                  );
                  break;
                }

                if (outgoingRelation.target.type === 'single') {
                  //one to one
                  targetEntity[targetField] = undefined;
                } else if (outgoingRelation.target.type === 'collection') {
                  const targetArray = targetEntity[targetField] as Array<
                    InferPoolEntityWithId<S['poolSchema']>['entity']
                  >;
                  targetEntity[targetField] = targetArray.filter(
                    (entity) => entity.id !== mutation.entity.id,
                  );
                }
              } else if (outgoingRelation.source.type === 'collection') {
                if (outgoingRelation.target.type === 'collection') break; //many to many not supported

                const targetIds = sourceEntity[
                  outgoingRelation.source.field
                ] as string[];

                for (const targetId of targetIds) {
                  const targetEntity = state.get(targetModelName, targetId)
                    ?.entity;
                  if (!targetEntity) {
                    console.log(
                      `failed tried to delete relation for target that does not exist: sourceId=${mutation.entity.id}, 
                      sourceField=${outgoingRelation.source.field}, targetId=${targetId}`,
                    );
                    break;
                  }
                  targetEntity[targetField] = undefined;
                }
              }
            }
          }
        },
      },
    });

  return {
    create: (
      root: InferEntity<S['rootView']['model']>,
      entities: InferPoolEntity<S['poolSchema']>[],
    ): {
      root: InferView<S['rootView']>;
      pool: Pool<S['poolSchema'], InferEntity<S['rootView']['model']>>;
    } => {
      const pool = poolFactoryOrDefault.create(root, entities);
      return {
        root: pool.root,
        pool,
      };
    },
    empty: (): {
      root: InferView<S['rootView']> | undefined;
      pool: Pool<
        S['poolSchema'],
        InferEntity<S['rootView']['model']> | undefined
      >;
    } => {
      const pool = poolFactoryOrDefault.empty();
      return {
        root: undefined,
        pool,
      };
    },
  };
}

//is this a good idea?
function filterInPlace<T>(
  a: T[],
  condition: (val: T, index: number) => boolean,
) {
  let i = 0,
    j = 0;

  while (i < a.length) {
    const val = a[i] as T;
    if (condition(val, i)) a[j++] = val;
    i++;
  }

  a.length = j;
  return a;
}
