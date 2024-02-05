import {
  DiscriminatedEntityWithId,
  InferPoolEntityName,
  InferPoolEntityWithId,
  InferPoolRootEntity,
  InferPoolRootEntityWithId,
  PoolSchemaAny,
} from '../core';
import { proxy, snapshot, subscribe } from 'valtio/vanilla';
import { ArrayMap, proxyArrayMap } from './proxyArrayMap';

//valtio doesn't export this type... which is helpful
export type Op = Parameters<Parameters<typeof subscribe>[1]>[0][number];
export type OnEntityChange<S extends PoolSchemaAny> = (
  name: InferPoolEntityName<S>,
  ops: Op[],
) => void;

export type ValtioPoolStateListeners<S extends PoolSchemaAny> = {
  //listens to proxy changes across all entities, this is fired asynchronously and automatically batched by valtio
  onChange?: OnEntityChange<S> | undefined;

  //these are called synchronously
  preSet?:
    | ((entity: InferPoolEntityWithId<S>) => InferPoolEntityWithId<S>['entity'])
    | undefined;
  postSet?:
    | ((
        name: InferPoolEntityName<S>,
        entity: InferPoolEntityWithId<S>['entity'],
      ) => void)
    | undefined;
  onDelete?: (entity: InferPoolEntityWithId<S>) => void | undefined;
};
class ValtioPoolState<S extends PoolSchemaAny> {
  //Observable type shits itself if i put the generic in there
  private entityTables: Map<
    InferPoolEntityName<S>,
    ArrayMap<string, InferPoolEntityWithId<S>['entity']>
  > = new Map();

  private listeners: ValtioPoolStateListeners<S>;

  constructor(schema: S, listeners: ValtioPoolStateListeners<S> = {}) {
    const combined = [schema.rootModel, ...schema.models];
    this.listeners = listeners;
    this.entityTables = new Map(
      combined.map((model) => {
        const entityTable = proxyArrayMap<
          string,
          DiscriminatedEntityWithId['entity']
        >();

        const onChange = this.listeners.onChange;
        if (onChange) {
          subscribe(entityTable, (ops) => onChange(model.name, ops));
        }
        return [model.name, entityTable];
      }),
    );
  }

  delete(name: InferPoolEntityName<S>, id: string): void {
    const entityTable = this.entityTables.get(name);
    if (!entityTable) return;
    if (this.listeners.onDelete) {
      const entity = entityTable.get(id);
      entityTable.delete(id);
      this.listeners.onDelete({ name, entity } as InferPoolEntityWithId<S>);
    } else {
      entityTable.delete(id);
    }
  }

  get(
    name: InferPoolEntityName<S>,
    id: string,
  ): InferPoolEntityWithId<S>['entity'] | undefined {
    return this.entityTables.get(name)?.get(id);
  }

  set(
    discriminatedEntity: InferPoolEntityWithId<S>,
  ): InferPoolEntityWithId<S>['entity'] {
    const entityTable = this.entityTables.get(discriminatedEntity.name)!;

    if (this.listeners.preSet) {
      const entityToCreate = this.listeners.preSet(discriminatedEntity);
      const entityProxy = proxy(entityToCreate);
      entityTable.set(discriminatedEntity.entity.id, entityProxy);
      this.listeners.postSet?.(discriminatedEntity.name, entityProxy);
      return entityProxy;
    } else {
      const entity = proxy(discriminatedEntity.entity);
      entityTable.set(discriminatedEntity.entity.id, entity);
      this.listeners.postSet?.(discriminatedEntity.name, entity);
      return entity;
    }
  }

  snapshot(): InferPoolEntityWithId<S>[] {
    const snapshotEntity: InferPoolEntityWithId<S>[] = [];
    for (const [entityName, table] of this.entityTables) {
      const tableSnapshot = snapshot(table);
      for (const [entityId, entity] of tableSnapshot) {
        snapshotEntity.push({
          name: entityName,
          entity: entity,
        } as InferPoolEntityWithId<S>);
      }
    }

    return snapshotEntity;
  }

  getEntityTables() {
    return this.entityTables;
  }
  getEntityTable(name: InferPoolEntityName<S>) {
    return this.entityTables.get(name)!;
  }
}

// export interface ValtioMutationHandler<S extends PoolSchemaAny> {
//   //this gets called before the mutation is applied to the pool
//   preCreate?: (
//     discriminatedEntity: InferPoolEntityWithId<S>,
//   ) => InferPoolEntityWithId<S>['entity'];
//
//   //this gets called after the mutation is applied to the pool
//   //and hence provides reference to the proxy
//   onEntityChange?: (name: InferPoolEntityName<S>, ops: Op[]) => void;
//   postCreate?: (
//     name: InferPoolEntityName<S>,
//     discriminatedEntity: InferPoolEntityWithId<S>['entity'],
//   ) => void;
// }
export interface ValtioPoolOptions<S extends PoolSchemaAny> {
  listeners: ValtioPoolStateListeners<S>;
}
export class ValtioPool<S extends PoolSchemaAny> {
  private rootState: InferPoolRootEntity<S> | undefined;
  private schema: S;
  private state: ValtioPoolState<S>;

  constructor(schema: S, options: ValtioPoolOptions<S> = { listeners: {} }) {
    this.schema = schema;
    this.rootState = undefined;
    this.state = new ValtioPoolState<S>(this.schema, {
      onChange: (name, ops) => {
        options.listeners.onChange?.(name, ops);
        if (
          this.rootState === undefined &&
          name === this.schema.rootModel.name
        ) {
          for (const change of ops) {
            const [op, path, current, prev] = change;

            if (path.length === 1) {
              //got a change that sets the whole table (i.e. been loaded in from storage)
            } else if (path.length === 3) {
              const entity = current as InferPoolEntityWithId<S>['entity'];
              this.rootState = entity as InferPoolRootEntity<S>;
            }
          }
        }
      },
      ...options.listeners,
    });
  }

  createRoot(
    root: InferPoolRootEntityWithId<S>['entity'],
    entities?: InferPoolEntityWithId<S>[] | undefined,
  ): InferPoolRootEntity<S> {
    const createdRoot = this.state.set({
      name: this.schema.rootModel.name,
      entity: root,
    });
    if (entities) {
      for (const entity of entities) {
        this.createEntity(entity);
      }
    }

    return createdRoot;
  }
  createEntity<T extends InferPoolEntityWithId<S>>(entity: T): T['entity'] {
    return this.state.set(entity);
  }
  getRoot(): InferPoolRootEntity<S> | undefined {
    return this.rootState;
  }
  getEntity<
    N extends InferPoolEntityName<S>,
    T extends InferPoolEntityWithId<S>,
  >(name: N, id: string): InferPoolEntityWithId<S>['entity'] | undefined {
    return this.state.get(name, id);
  }

  getState(): ValtioPoolState<S> {
    return this.state;
  }
}
