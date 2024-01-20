import {
  DiscriminatedEntityWithId,
  ModelAny,
  OutgoingRelationship,
} from '../core/model';
import {
  batch,
  beginBatch,
  computed,
  endBatch,
  observable,
  ObservableArray,
  ObservableObject,
  ObservablePrimitive,
  ObservableState,
  WithPersistState,
} from '@legendapp/state';
import {
  CreateMutation,
  InferPoolEntity,
  InferPoolEntityName,
  InferPoolEntityWithId,
  InferPoolModel,
  InferPoolRootEntity,
  InferPoolRootEntityWithId,
  PoolSchemaAny,
} from '../core/pool';
import { ListenerParams } from '@legendapp/state/src/observableInterfaces';
import z from 'zod';
import {
  GraphSchemaAny,
  InferGraphRootResolvedEntity,
  InferGraphView,
} from '../core/graph';
import { InferView } from '../core/view';
import {
  configureObservablePersistence,
  persistObservable,
} from '@legendapp/state/persist';
import { ObservablePersistIndexedDB } from '@legendapp/state/persist-plugins/indexeddb';

class ObservablePoolState<S extends PoolSchemaAny> {
  //Observable type shits itself if i put the generic in there
  private entities: Map<
    InferPoolEntityName<S>,
    ObservableObject<{
      [key: string]: DiscriminatedEntityWithId['entity'];
    }>
  > = new Map();
  private loadedMap: Map<
    InferPoolEntityName<S>,
    ObservableObject<{
      //isLoadedLocal: boolean;
    }>
  > = new Map();
  private onSet:
    | ((entity: InferObservableDiscriminatedEntity<InferPoolModel<S>>) => void)
    | undefined;

  constructor(
    schema: S,
    onChange:
      | ((name: InferPoolEntityName<S>, params: ListenerParams) => void)
      | undefined,
    //called just after an entity has been added to the pool in the same batch
    onSet?: (
      entity: InferObservableDiscriminatedEntity<InferPoolModel<S>>,
    ) => void,
  ) {
    const combined = [schema.rootModel, ...schema.models];
    this.entities = new Map(
      combined.map((model) => {
        const entityTable = observable(
          {} as {
            [key: string]: DiscriminatedEntityWithId['entity'];
          },
        );
        if (onChange) {
          entityTable.onChange((params) => onChange(model.name, params));
        }
        return [model.name, entityTable];
      }),
    );
    this.onSet = onSet;
  }

  delete(name: InferPoolEntityName<S>, id: string): void {
    const entityTable = this.entities.get(name);
    entityTable?.['test']?.delete();
  }

  get(
    name: InferPoolEntityName<S>,
    id: string,
  ): ObservableObject<InferPoolEntityWithId<S>['entity']> | undefined {
    const entityTable = this.entities.get(name);
    const entity = entityTable?.[id];
    return entity as
      | ObservableObject<InferPoolEntityWithId<S>['entity']>
      | undefined;
  }

  set(
    discriminatedEntity: InferPoolEntityWithId<S>,
  ): ObservableObject<InferPoolEntityWithId<S>['entity']> {
    const entityTable = this.entities.get(discriminatedEntity.name);
    batch(() => {
      const result = entityTable![discriminatedEntity.entity.id]!.set(
        discriminatedEntity.entity,
      ) as ObservableObject<InferPoolEntityWithId<S>['entity']>;
      this.onSet?.({
        name: discriminatedEntity.name,
        entity: result,
      } as InferObservableDiscriminatedEntity<InferPoolModel<S>>);
    });

    //want to return the observable we just created but cus we run the set in a batch
    //got to do this
    return this.get(discriminatedEntity.name, discriminatedEntity.entity.id)!;
  }

  snapshot(): InferPoolEntityWithId<S>[] {
    const snapshotEntity: InferPoolEntityWithId<S>[] = [];
    for (const [entityName, table] of this.entities) {
      const tableValue = table.peek();
      for (const entityId in table.peek()) {
        const entity = tableValue[entityId];
        snapshotEntity.push({
          name: entityName,
          entity: entity,
        } as InferPoolEntityWithId<S>);
      }
    }

    return snapshotEntity;
  }

  getEntityStatus(name: InferPoolEntityName<S>) {
    return this.loadedMap.get(name)!;
  }

  getStatus() {
    const all = new Array<{
      name: InferPoolEntityName<S>;
      status: ObservableObject<{}>;
    }>();
    for (const [name, status] of this.loadedMap) {
      all.push({ name, status });
    }
    return all;
  }
  getEntities() {
    return this.entities;
  }
}

export type InferObservableDiscriminatedEntity<RM extends ModelAny> =
  RM extends any
    ? {
        readonly name: RM['name'];
        entity: ObservableObject<
          z.infer<RM['schema']> & { readonly id: string }
        >;
      }
    : never;

interface ObservableMutationHandler<S extends PoolSchemaAny> {
  //this gets called before the mutation is applied to the pool
  //if an entity is returned it will be used to create the observable entity and saved in the pool
  preCreate?: (
    state: ObservablePoolState<S>,
    discriminatedEntity: InferPoolEntity<S>,
  ) => InferPoolEntity<S>['entity'] | undefined;
  //this gets called after the mutation is applied to the pool
  //and hence provides reference to the observable entity
  //useful to attach reactions etc
  postCreate?: (
    state: ObservablePoolState<S>,
    //this is the entity we're about to create
    observableEntity: InferObservableDiscriminatedEntity<InferPoolModel<S>>,
    mutation: CreateMutation<InferPoolModel<S>>,
  ) => void;
}
export interface ObservablePoolOptions<S extends PoolSchemaAny> {
  onMutation?: ObservableMutationHandler<S>;
}
export class ObservablePool<S extends PoolSchemaAny> {
  private rootState: ObservableObject<InferPoolRootEntity<S>> | undefined;
  private schema: S;
  private state: ObservablePoolState<S>;

  constructor(
    schema: S,
    options?: ObservablePoolOptions<S>,
    poolState?: ObservablePoolState<S>,
  ) {
    this.schema = schema;
    this.rootState = undefined;
    this.state =
      poolState ??
      new ObservablePoolState(
        this.schema,
        (name, { value, changes }) => {
          const entityChanges: Map<string, ObservableObject<any>> = new Map();
          for (const change of changes) {
            if (change.path.length === 0) {
              //got a change that sets the whole table (i.e. been loaded in from storage)
              for (const entityId in value) {
                const entity = this.state.get(name, entityId)!;
                //forgive me for i have sinned
                const discriminatedEntity = {
                  name,
                  entity: entity,
                } as InferObservableDiscriminatedEntity<InferPoolModel<S>>;
                //this is a create
                options?.onMutation?.postCreate?.(
                  this.state,
                  discriminatedEntity,
                  {
                    name,
                    operation: 'Create',
                    entity: discriminatedEntity.entity,
                  },
                );
                if (
                  this.rootState === undefined &&
                  name === this.schema.rootModel.name
                )
                  this.rootState = discriminatedEntity.entity as any;
              }
            } else if (change.path.length === 1) {
              //got a change containing a single entity
              const entityId = change.path[0] as string;
              const entity = this.state.get(name, entityId)!;
              //forgive me for i have sinned
              const discriminatedEntity = {
                name,
                entity: entity,
              } as InferObservableDiscriminatedEntity<InferPoolModel<S>>;
              //this is a create
              options?.onMutation?.postCreate?.(
                this.state,
                discriminatedEntity,
                {
                  name,
                  operation: 'Create',
                  entity: discriminatedEntity.entity,
                },
              );
              if (
                this.rootState === undefined &&
                name === this.schema.rootModel.name
              )
                this.rootState = discriminatedEntity.entity as any;
            }
          }
        },
        (discriminatedEntity) => {
          //oh gosh oh geez
          // options?.onMutation?.postCreate?.(this.state, discriminatedEntity, {
          //   name: discriminatedEntity.name,
          //   operation: 'Create',
          //   entity: discriminatedEntity.entity,
          // });
          // if (
          //   this.rootState === undefined &&
          //   discriminatedEntity.name === this.schema.rootModel.name
          // )
          //   this.rootState = discriminatedEntity.entity as any;
        },
      );
  }

  createRoot(
    root: InferPoolRootEntityWithId<S>['entity'],
    entities?: InferPoolEntityWithId<S>[] | undefined,
  ): ObservableObject<InferPoolRootEntity<S>> {
    beginBatch();
    const createdRoot = this.state.set({
      name: this.schema.rootModel.name,
      entity: root,
    });
    if (entities) {
      for (const entity of entities) {
        this.createEntity(entity);
      }
    }
    endBatch();

    return createdRoot as ObservableObject<InferPoolRootEntity<S>>;
  }
  createEntity<T extends InferPoolEntityWithId<S>>(
    entity: T,
  ): ObservableObject<T['entity']> {
    const created = this.state.set(entity);
    return created as ObservableObject<T['entity']>;
  }
  getRoot(): ObservableObject<InferPoolRootEntity<S>> | undefined {
    return this.rootState;
  }
  getState(): ObservablePoolState<S> {
    return this.state;
  }
}

export interface ObservableGraphOptions {}
export class ObservableGraph<S extends GraphSchemaAny> {
  private readonly schema: S;
  private readonly viewMap: Map<
    InferGraphView<S>['model']['name'],
    InferGraphView<S>
  >;
  private readonly pool: ObservablePool<S['poolSchema']>;

  constructor(schema: S, options?: ObservableGraphOptions) {
    this.schema = schema;
    this.viewMap = new Map(
      [schema.rootView, ...schema.views].map((view) => [view.model.name, view]),
    );
    this.pool = new ObservablePool<S['poolSchema']>(this.schema.poolSchema, {
      onMutation: getObservableMutationHandler(this.viewMap),
    });
  }

  getViews() {
    return this.viewMap;
  }
  getPool(): ObservablePool<S['poolSchema']> {
    return this.pool;
  }

  getRoot(): InferGraphRootResolvedEntity<S> | undefined {
    return this.pool.getRoot() as InferGraphRootResolvedEntity<S> | undefined;
  }

  createRoot(
    rootSnapshot: InferPoolRootEntityWithId<S['poolSchema']>['entity'],
    entities?: InferPoolEntityWithId<S['poolSchema']>[],
  ): ObservableObject<InferGraphRootResolvedEntity<S>> {
    //todo create these in the same batch?
    const root = this.pool.createRoot(rootSnapshot, entities ?? []);
    for (const entity of entities ?? []) {
      this.pool.createEntity(entity);
    }
    return root as InferGraphRootResolvedEntity<S>;
  }

  create<T extends InferPoolEntityName<S['poolSchema']>>(
    name: T,
    entity: Extract<
      InferPoolEntityWithId<S['poolSchema']>,
      { name: T }
    >['entity'],
  ): ObservableObject<
    InferView<Extract<InferGraphView<S>, { model: { name: T } }>>
  > {
    const foundEntity = this.pool.createEntity({ name, entity });
    return foundEntity as any;
  }

  get<T extends InferPoolEntityName<S['poolSchema']>>(
    name: T,
    id: string,
  ):
    | ObservableObject<
        InferView<Extract<InferGraphView<S>, { model: { name: T } }>>
      >
    | undefined {
    const entity = this.pool.getState().get(name, id);
    return entity as any;
  }
}

export function persistGraph<T extends GraphSchemaAny>(
  graph: ObservableGraph<T>,
  {
    databaseName,
    version,
    ...rest
  }: {
    databaseName: string;
    version: number;
    [key: string]: any;
  },
) {
  const entities = graph.getPool().getState().getEntities();
  const tables = Array.from(entities.keys());
  configureObservablePersistence({
    pluginLocal: ObservablePersistIndexedDB,
    localOptions: {
      indexedDB: {
        databaseName: databaseName,
        version: version,
        tableNames: tables,
      },
      ...rest,
    },
  });

  const entityStatus = new Map<
    InferPoolEntityName<T['poolSchema']>,
    ObservableObject<ObservableState>
  >();
  for (const [name, entityTable] of entities) {
    const entityView = graph.getViews().get(name);
    //usually I would use maps and concat for this stuff for this but trying out the good ol' procedural thing for a change
    const toIgnore = new Set<string>();
    if (!entityView) break;

    const fieldTransforms: Record<string, any> = {};

    for (const field in entityView.model.schema.shape) {
      fieldTransforms[field] = field;
    }

    if (entityView?.incomingRelations) {
      for (const relation of entityView.incomingRelations) {
        if (relation.target.field) {
          toIgnore.add(relation.target.field);
          fieldTransforms[relation.target.field] = null;
        }
      }
    }
    if (entityView?.outgoingRelations) {
      for (const relation of entityView.outgoingRelations) {
        if (relation.source.materializedAs) {
          toIgnore.add(relation.source.materializedAs);
          fieldTransforms[relation.source.materializedAs] = null;
        }
      }
    }

    let count = 0;
    const status = persistObservable(entityTable, {
      local: {
        name,
        transform: {},
        //@ts-ignore
        //its possible to use field transforms to filter out fields with a null
        //but then you have to supply values for all the keys you want unchanged too which isn't very helpful
        fieldTransforms: {
          _dict: fieldTransforms,
        },
      }, // IndexedDB table name
      remote: {
        offlineBehavior: 'retry',
        //@ts-ignore
        fieldTransforms: {
          _dict: fieldTransforms as any,
        },
      },
    });

    entityStatus.set(name, status.state as any);
  }
  return entityStatus;
}

function onRelation<
  S extends GraphSchemaAny,
  E,
  R extends OutgoingRelationship<ModelAny>,
>(
  relations: R[],
  entity: E,
  handler: {
    //one to one
    singleToSingle(relation: R, entity: E): void;
    //many to one
    singleToCollection(relation: R, entity: E): void;
    //one to many
    collectionToSingle(relation: R, entity: E): void;
  },
) {
  for (const relation of relations) {
    if (
      relation.source.type === 'single' &&
      relation.target.type === 'single'
    ) {
      //one to one
      handler.singleToSingle(relation, entity);
    }
    if (
      relation.source.type === 'single' &&
      relation.target.type === 'collection'
    ) {
      //many to one
      handler.singleToCollection(relation, entity);
    }
    if (
      relation.source.type === 'collection' &&
      relation.target.type === 'single'
    ) {
      //one to many
      handler.collectionToSingle(relation, entity);
    }
  }
}

function getObservableMutationHandler<S extends GraphSchemaAny>(
  viewMap: Map<InferGraphView<S>['model']['name'], InferGraphView<S>>,
): ObservableMutationHandler<S['poolSchema']> {
  return {
    postCreate(state, discriminatedEntity, mutation) {
      const view = viewMap.get(mutation.name);
      if (!view) return;

      const sourceEntity = discriminatedEntity.entity;

      if (view.incomingRelations) {
        //need to initialise materialise incoming relations (e.g. set array refs to empty etc
        //not sure what to do with single refs tbh
        //i'm not paying much attention to what order things get initialised in
        //so i'm doing more checks for undefined / uninitialised then is probably necessary
        onRelation(view.incomingRelations, sourceEntity, {
          singleToSingle(incomingRelation, entity) {},
          singleToCollection(incomingRelation, entity) {
            if (incomingRelation.target.field) {
              const materialisedAs = entity[incomingRelation.target.field];
              if (materialisedAs.peek() === undefined) {
                materialisedAs.set([]);
                Object.defineProperty(
                  entity.peek(),
                  incomingRelation.target.field,
                  {
                    enumerable: false,
                  },
                );
              }
            }
          },
          collectionToSingle(incomingRelation, entity) {},
        });
      }

      //todo: passing around the state in get closures is probably not good for performance
      //just pass in the state object
      if (view.outgoingRelations) {
        onRelation(view.outgoingRelations, sourceEntity, {
          singleToSingle(outgoingRelation, entity) {
            materialiseSingleToSingle(
              extractSourceSingle(entity, outgoingRelation.source),
              extractTarget(outgoingRelation.target),
              extractGetter(
                outgoingRelation,
                (name, id) =>
                  state.get(name, id) as ObservableEntity | undefined,
              ),
            );
          },
          singleToCollection(outgoingRelation, entity) {
            materialiseSingleToCollection(
              extractSourceSingle(entity, outgoingRelation.source),
              extractTarget(outgoingRelation.target),
              extractGetter(
                outgoingRelation,
                (name, id) =>
                  state.get(name, id) as ObservableEntity | undefined,
              ),
            );
          },
          collectionToSingle(outgoingRelation, entity) {
            materialiseCollectionToSingle(
              extractSourceCollection(entity, outgoingRelation.source),
              extractTarget(outgoingRelation.target),
              extractGetter(
                outgoingRelation,
                (name, id) =>
                  state.get(name, id) as ObservableEntity | undefined,
              ),
            );
          },
        });
      }
    },
  };
}

interface SourceRef<T> {
  id: string;
  //portals through to another entity in the graph, the returned observable:
  //1. does get notified when the entry entity is modified but only when listening to the observable returned, not on nested fields (no idea why)
  //2. does get notified when this entity is modified by others (i.e. those that have portaled to it)
  //3. does notify others listening to this entity
  //4. does not notify the entry entity when modified
  portal(view: any): ObservableObject<T>;

  //appends a readonly branch containing the referenced entity to the current "tree", the returned observable:
  //1. does get notified when the parent is modified when listening anywhere in the branch
  //2. does not get notified when others modify this entity elsewhere in the graph
  //3. can not be modified
  // branch: ObservableComputed<T>;

  //replace this reference with another, only available on the source of the reference
  replaceWith(replacement?: T): void;
}

interface TargetRef<T> {
  id: string;
  //portals through to another entity in the graph, the returned observable:
  //1. does get notified when the entry entity is modified but only when listening to the observable returned, not on nested fields (no idea why)
  //2. does get notified when this entity is modified by others (i.e. those that have portaled to it)
  //3. does notify others listening to this entity
  //4. does not notify the entry entity when modified
  portal(view: any): ObservableObject<T>;

  //appends a readonly branch containing the referenced entity to the current "tree", the returned observable:
  //1. does get notified when the parent is modified when listening anywhere in the branch
  //2. does not get notified when others modify this entity elsewhere in the graph
  //3. can not be modified
  // branch: ObservableComputed<T>;
}

interface TargetLazyRef<T extends { id: string; [key: string]: any }> {
  refId: ObservablePrimitive<string>;
  getEntity: (id: string) => ObservableObject<T> | undefined;
}

interface SourceLazyRef<T extends { id: string; [key: string]: any }> {
  refId: ObservablePrimitive<string>;
  getEntity: (id: string) => ObservableObject<T> | undefined;
  sourceRefId?: ObservablePrimitive<string>;
}

// function lazySyncEntity<T>(ref: () => LazyRef<T>): () => ObservableObject<T> {
//   return () => ref.pool[ref.refId.get()]!;
// }
// function initRefLazy< T extends {id: string, [key: string]: any}>(lazyRef: () => LazyRef<T>, initialId?: string): Ref<T> {
//   const lazySync = () => {
//     //how can i avoid the computed from calling this function without having to evaluate whats in the ref yet
//     const ref = lazyRef();
//     //if entity can't be found then this shits the bed
//     return ref.getEntity(ref.refId.get())!;
//   };
//   return {
//     id: initialId ?? '',
//     portal: cached(computed<ObservableObject<T>>(lazySync)),
//     replace(replacement?: T) {
//
//     },
//   };
// }
function initSourceRef<T extends { id: string; [key: string]: any }>(
  ref: SourceLazyRef<T>,
  initialId?: string,
): SourceRef<T> {
  return {
    id: initialId ?? '',
    portal: cached(
      computed<ObservableObject<T>>(() => ref.getEntity(ref.refId.get())!),
    ),
    replaceWith(replacement: T) {
      ref.sourceRefId?.set(replacement.id);
    },
  };
}

function initTargetRef<T extends { id: string; [key: string]: any }>(
  ref: TargetLazyRef<T>,
  initialId?: string,
): TargetRef<T> {
  return {
    id: initialId ?? '',
    portal: cached(
      computed<ObservableObject<T>>(() => ref.getEntity(ref.refId.get())!),
    ),
  };
}

function cached<T>(cached: T) {
  return () => cached;
}

interface Getters<S extends ObservableEntity, T extends ObservableEntity> {
  getSourceEntity: (id: string) => ObservableEntity | undefined;
  getTargetEntity: (id: string) => ObservableEntity | undefined;
}

interface TargetFields {
  //the name of the property to be materialised to in the target
  //can use a direct reference because we don't have target to use yet
  materialisedAs: string | undefined;
}

interface SourceSingleFields<T> {
  entity: ObservableEntity;
  id: ObservablePrimitive<string>;
  field: ObservablePrimitive<string>;
  materialise:
    | {
        toMaterialise: true;
        asFieldName: string;
        as: ObservableObject<SourceRef<T>>;
      }
    | { toMaterialise: false };
}
interface SourceCollectionFields<T> {
  entity: ObservableEntity;
  id: ObservablePrimitive<string>;
  field: ObservableArray<string[]>;
  materialise:
    | {
        toMaterialise: true;
        asFieldName: string;
        as: ObservableArray<SourceRef<T>[]>;
      }
    | { toMaterialise: false };
}

function extractSourceSingle<T>(
  sourceEntity: ObservableEntity,
  relationSource: OutgoingRelationship<ModelAny>['source'],
): SourceSingleFields<T> {
  return {
    entity: sourceEntity,
    id: sourceEntity.id,
    field: sourceEntity[relationSource.field],
    materialise: relationSource.materializedAs
      ? {
          toMaterialise: true,
          asFieldName: relationSource.materializedAs,
          as: sourceEntity[relationSource.materializedAs],
        }
      : { toMaterialise: false },
  };
}
function extractSourceCollection<T>(
  sourceEntity: ObservableEntity,
  relationSource: OutgoingRelationship<ModelAny>['source'],
): SourceCollectionFields<T> {
  return {
    entity: sourceEntity,
    id: sourceEntity.id,
    field: sourceEntity[relationSource.field],
    materialise: relationSource.materializedAs
      ? {
          toMaterialise: true,
          asFieldName: relationSource.materializedAs,
          as: sourceEntity[relationSource.materializedAs],
        }
      : { toMaterialise: false },
  };
}

function extractTarget(
  relationTarget: OutgoingRelationship<ModelAny>['target'],
): TargetFields {
  return {
    materialisedAs: relationTarget.field,
  };
}

function extractGetter(
  relation: OutgoingRelationship<ModelAny>,
  get: (name: string, id: string) => ObservableEntity | undefined,
): Getters<ObservableEntity, ObservableEntity> {
  return {
    getSourceEntity: getWithName(relation.source.model.name, get),
    getTargetEntity: getWithName(relation.target.model.name, get),
  };
}
type ObservableEntity = ObservableObject<{ id: string; [key: string]: any }>;

// interface ExtractedRelation<
//   S extends ObservableEntity,
//   T extends ObservableEntity,
// > {
//   source: {
//     field: string;
//     materialisedAs: string | undefined;
//     getEntity: (id: string) => S | undefined;
//   };
//   target: {
//     materialisedAs: string | undefined;
//     getEntity: (id: string) => T | undefined;
//   };
// }
// function extractRelation<S extends PoolSchemaAny, M extends ModelAny>(
//   relation: OutgoingRelationship<M>,
//   get: ObservablePoolState<S>['get'],
// ): ExtractedRelation<ObservableEntity, ObservableEntity> {
//   return {
//     source: {
//       field: relation.source.field,
//       materialisedAs: relation.source.materializedAs,
//       getEntity: getWithName<S>(relation.source.model.name, get),
//     },
//     target: {
//       materialisedAs: relation.target.field,
//       getEntity: getWithName(relation.target.model.name, get),
//     },
//   };
// }
function materialiseSingleToSingle<
  S extends ObservableObject<{
    id: string;
    [keys: string]: any;
  }>,
  T extends ObservableObject<{
    id: string;
    [keys: string]: any;
  }>,
>(source: SourceSingleFields<{}>, target: TargetFields, getter: Getters<S, T>) {
  if (source.materialise && target.materialisedAs) return;
  //ideally we optimise the on change by use a different on change depending on what we need to materialise
  source.field.onChange(
    (change) => {
      const sourceId = source.id.peek();
      //prev will be undefined the first time this is run but its not typed correctly...
      const prev: string | undefined = change.getPrevious();

      batch(() => {
        //materialise target to self
        if (source.materialise.toMaterialise) {
          // if(targetSingle.peek()) {
          //   targetSingle.id.set(sourceId);
          // } else {
          //   targetSingle.set(initRef({refId: targetSingle.id, getEntity: getter.getSourceEntity}, sourceId))
          // }

          if (source.materialise.as.peek()) {
            source.materialise.as.id.set(change.value);
          } else {
            source.materialise.as.set(
              initSourceRef(
                {
                  refId: source.materialise.as.id,
                  getEntity: getter.getTargetEntity,
                  sourceRefId: source.field,
                },
                change.value,
              ),
            );
            Object.defineProperty(
              source.entity.peek(),
              source.materialise.asFieldName,
              {
                enumerable: false,
              },
            );
          }
        }

        //materialise self to target
        if (target.materialisedAs) {
          if (prev !== undefined && prev !== change.value) {
            //remove self from previous target
            const prevTargetEntity = getter.getTargetEntity(prev);
            if (prevTargetEntity) {
              const prevTargetSingle = prevTargetEntity[
                target.materialisedAs
              ] as ObservableObject<TargetRef<{}>>;
              //todo: probably don't set this to undefined an try to reuse the ref instead
              prevTargetSingle.set(undefined);
            }
          }

          //materialise ourselves onto new target
          const targetEntity = getter.getTargetEntity(change.value);
          if (!targetEntity) return;

          //would think you could type this better by typing S and T as objects then wrapping in ObservableObject
          // where necessary but ObservableObject is weird and that breaks things even harder
          const targetSingle = targetEntity[
            target.materialisedAs
          ] as ObservableObject<TargetRef<{}>>;
          //the reference may not exist yet if its just been created, so create it
          if (targetSingle.peek()) {
            targetSingle.id.set(sourceId);
          } else {
            targetSingle.set(
              initTargetRef(
                { refId: targetSingle.id, getEntity: getter.getSourceEntity },
                sourceId,
              ),
            );
            Object.defineProperty(targetEntity.peek(), target.materialisedAs, {
              enumerable: false,
            });
          }
        }
      });
    },
    { initial: true },
  );
}

function materialiseSingleToCollection<
  S extends ObservableEntity,
  T extends ObservableEntity,
>(source: SourceSingleFields<{}>, target: TargetFields, getter: Getters<S, T>) {
  source.field.onChange(
    (change) => {
      const sourceId = source.id.peek();
      //prev will be undefined the first time this is run but its not typed correctly...
      const prev: string | undefined = change.getPrevious();

      batch(() => {
        //materialise target to self
        if (source.materialise.toMaterialise) {
          if (source.materialise.as.peek()) {
            source.materialise.as.id.set(change.value);
          } else {
            source.materialise.as.set(
              initSourceRef(
                {
                  refId: source.materialise.as.id,
                  getEntity: getter.getTargetEntity,
                  sourceRefId: source.field,
                },
                change.value,
              ),
            );
            Object.defineProperty(
              source.entity.peek(),
              source.materialise.asFieldName,
              {
                enumerable: false,
              },
            );
          }
        }

        //materialise self to target

        if (target.materialisedAs) {
          if (prev !== undefined && prev !== change.value) {
            const prevTargetEntity = getter.getTargetEntity(prev);
            if (prevTargetEntity) {
              const prevTargetCollection = prevTargetEntity[
                target.materialisedAs
              ] as ObservableArray<TargetRef<any>[]>;
              prevTargetCollection.set(
                prevTargetCollection
                  .peek()
                  .filter((ref) => ref.id !== sourceId),
              );
            }
          }

          const targetEntity = getter.getTargetEntity(change.value);
          if (!targetEntity) return;

          //would think you could type this better by typing S and T as objects then wrapping in ObservableObject
          // where necessary but ObservableObject is weird and that breaks things even harder
          const targetCollection = targetEntity[
            target.materialisedAs
          ] as ObservableArray<TargetRef<{}>[]>;

          if (targetCollection.peek() === undefined) {
            targetCollection.set([]);
            Object.defineProperty(targetEntity.peek(), target.materialisedAs, {
              enumerable: false,
            });
          }
          const ref = initTargetRef(
            {
              refId: targetCollection[targetCollection.length]!.id,
              getEntity: getter.getSourceEntity,
            },
            sourceId,
          );
          targetCollection.push(ref);
        }
      });
    },
    { initial: true },
  );
}

function materialiseCollectionToSingle<
  S extends ObservableObject<{
    id: string;
    [keys: string]: any;
  }>,
  T extends ObservableObject<{
    id: string;
    [keys: string]: any;
  }>,
>(
  source: SourceCollectionFields<{}>,
  target: TargetFields,
  getter: Getters<S, T>,
) {
  source.field.onChange(
    (params) => {
      let index = 0;
      for (const messageId of params.value) {
        //materialise on source
        if (source.materialise.toMaterialise) {
          const sourceMaterialisedAs = source.materialise.as;
          const messageRef = sourceMaterialisedAs[index];
          if (messageRef?.peek()) {
            messageRef.id.set(messageId);
          } else {
            const ref = initSourceRef(
              {
                refId: sourceMaterialisedAs[index]!.id,
                getEntity: getter.getTargetEntity,
                sourceRefId: source.field[index],
              },
              messageId,
            );
            sourceMaterialisedAs.push(ref);
          }
          Object.defineProperty(
            source.entity.peek(),
            source.materialise.asFieldName,
            {
              enumerable: false,
            },
          );
        }
        //materialise on target
        if (target.materialisedAs) {
          const targetEntity = getter.getTargetEntity(messageId);
          if (targetEntity) {
            const targetRef = targetEntity[
              target.materialisedAs
            ] as ObservableObject<TargetRef<S>>;

            //idk man the typing gets messed up
            const targetRefId = targetRef.id as ObservablePrimitive<string>;
            if (targetRef.peek()) {
              targetRefId.set(source.id.peek());
            } else {
              //Observable type gets fucked up by generics
              targetRef.set(
                initTargetRef(
                  {
                    refId: targetRefId,
                    getEntity: getter.getTargetEntity,
                  },
                  source.id.peek(),
                ) as any,
              );
              Object.defineProperty(
                targetEntity.peek(),
                target.materialisedAs,
                {
                  enumerable: false,
                },
              );
            }
          }
        }

        index++;
      }

      if (source.materialise.toMaterialise) {
        //resize the array to match the messageIds
        //doing this with pop because it seems safer
        //the observable array might handle updating affected people
        for (let i = index; i < source.materialise.as.length; i++) {
          // const messageRef = edUser.messages[i]!;
          // messageRef.id.set(undefined);
          //maybe find a way to reuse the ref, so that we're not recreating computeds
          source.materialise.as.pop();
        }
      }
    },
    { initial: true },
  );
}

function getWithName<S extends PoolSchemaAny>(
  name: string,
  get: ObservablePoolState<S>['get'],
) {
  return (id: string) =>
    get(name, id) as ObservableObject<{ id: string; [key: string]: any }>;
}
