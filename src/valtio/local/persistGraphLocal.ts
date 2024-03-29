import { EntityWithIdAny, ValtioGraph } from '../valtioGraph';
import { GraphSchemaAny } from '../../core';
import { openDB } from 'idb';
import { proxy, snapshot, subscribe } from 'valtio/vanilla';
import { keyFromArrayMapPath, proxyArrayMap } from '../proxyArrayMap';

export interface PersistLocalOptions {
  name: string;
  version: number;
  autoFlush?:
    | {
        interval: number;
      }
    | false;
}

export interface EntityPersistStatus {
  loaded: boolean;
}

export interface GraphPersistStatus {
  loaded: boolean;
  flush: () => Promise<void>;
  //root: EntityPersistStatus
}

export function persistGraphLocal<S extends GraphSchemaAny>(
  graph: ValtioGraph<S>,
  options: PersistLocalOptions,
): GraphPersistStatus {
  const statusEntries: [string, { loaded: boolean }][] = [];
  for (const [name, viewIndex] of graph.getViews()) {
    statusEntries.push([name, { loaded: false }]);
  }
  const entityStatusMap = proxyArrayMap(statusEntries);
  const status = proxy({
    loaded: false,
    root: { loaded: false },
    entities: entityStatusMap,
    flush: () => {
      throw Error('db not initialised');
    },
  });

  let flush = function flush() {
    throw Error('db not initialised');
  };

  doPersistGraphLocal(graph, options, status);
  return status;
}

async function doPersistGraphLocal<S extends GraphSchemaAny>(
  graph: ValtioGraph<S>,
  options: PersistLocalOptions,
  status: GraphPersistStatus,
) {
  const db = await openDB(options.name, options.version, {
    upgrade(db, oldVersion, newVersion, transaction, event) {
      for (const [name, viewIndex] of graph.getViews()) {
        //todo: configurable id field
        db.createObjectStore(name, {
          keyPath: 'id',
        });
      }

      // …
    },
    blocked(currentVersion, blockedVersion, event) {
      // …
    },
    blocking(currentVersion, blockedVersion, event) {
      // …
    },
    terminated() {
      // …
    },
  });

  //first load all entities into graph
  for (const [name, viewIndex] of graph.getViews()) {
    if (name === graph.getSchema().rootView.model.name) {
      const tx = db.transaction(name);

      for await (const cursor of tx.store) {
        const entity = cursor.value as EntityWithIdAny;
        graph.getPool().createRoot(entity);
        console.log('loaded root');
      }
    } else {
      const tx = db.transaction(name);

      for await (const cursor of tx.store) {
        const entity = cursor.value as EntityWithIdAny;
        graph.getPool().createEntity({ name, entity });
      }
    }
  }

  //then materialise them to resolve references
  for (const [name, viewIndex] of graph.getViews()) {
    const entities = graph.getPool().getState().getEntityTable(name);
    for (const [entityId, entity] of entities.data) {
      graph.materialiseEntity(name, entity);
    }
  }

  const dirtyEntityCaches: Map<
    string,
    {
      seen: Set<string>;
      dirtyEntities: { id: string; type: 'set' | 'delete' }[];
    }
  > = new Map(
    Array.from(graph.getViews().entries()).map(([name]) => [
      name,
      { dirtyEntities: [], seen: new Set() },
    ]),
  );

  type FlushCommand = {
    entityName: string;
    entities: (
      | { type: 'set'; entity: EntityWithIdAny }
      | { type: 'delete'; id: string }
    )[];
  };

  const flush = () => {
    //first we construct a bunch of write commands and clear the dirty cache
    //then we'll fire of the commands in a single async transaction
    //and return early (before the transaction completes)
    //this seems like the best way to not end up with weird async race conditions (hopefully)
    const commands = constructFlushCommands(dirtyEntityCaches, graph);
    if (commands.length === 0) {
      return Promise.resolve();
    }

    console.log('flushing');
    console.log(commands);
    const tx = db.transaction(
      commands.map((command) => command.entityName),
      'readwrite',
    );
    //this kicks of the promises
    //because js is weird
    commands.flatMap((command) => {
      const store = tx.objectStore(command.entityName);
      return command.entities.map((entity) => {
        switch (entity.type) {
          case 'set': {
            return store.put(entity.entity);
          }
          case 'delete': {
            return store.delete(entity.id);
          }
        }
      });
    });

    return tx.done;
  };
  //then subscribe to keep track of which entities have changed and need flushed
  //we use a seperate subscribe than the one used in the graph to watch references
  //because this will contain all the reference changes batched together, so should get called less frequently
  for (const [name, viewIndex] of graph.getViews()) {
    const entityTable = graph.getPool().getState().getEntityTable(name);
    const dirtyEntityCache = dirtyEntityCaches.get(name)!;
    subscribe(entityTable, (ops) => {
      for (const change of ops) {
        const [op, path, current, prev] = change;
        if (path.length < 2) {
          //entity pool itself has been replaced (this would happen on initialising the pool?)
        } else if (path.length === 2) {
          //entity in pool replaced (this happens on entity create and delete)
          const entityId = keyFromArrayMapPath(entityTable, path);
          if (op === 'delete') {
            //it's possible to have one set and multiple deletes for the same entity,
            //but deletes should be rare so I think it's fine
            dirtyEntityCache.dirtyEntities.push({
              type: 'delete',
              id: entityId,
            });
          } else if (op === 'set') {
            if (!dirtyEntityCache.seen.has(entityId)) {
              dirtyEntityCache.dirtyEntities.push({
                type: 'set',
                id: entityId,
              });
              dirtyEntityCache.seen.add(entityId);
            }
          }
        } else if (path.length === 3) {
          //an existing entity has been replaced (probably shouldn't happen)
        } else if (path.length > 3) {
          //field in entity has been changed
          const fieldName = path[3] as string;

          //if this is a materialised ref field then ignore the change it
          const fieldRel = viewIndex.fieldRelations.get(fieldName);
          if (fieldRel && fieldRel.type !== 'source') {
            continue;
          }
          //a real field changed, find the entity that changed
          const entityId = keyFromArrayMapPath(entityTable, path);

          //don't care if its a set or a delete,
          //treat them both as entity level set
          if (!dirtyEntityCache.seen.has(entityId)) {
            dirtyEntityCache.dirtyEntities.push({ type: 'set', id: entityId });
            dirtyEntityCache.seen.add(entityId);
          }
        }
      }
    });

    const autoFlushConfig =
      options.autoFlush !== undefined
        ? options.autoFlush
        : {
            interval: 200,
          };
    status.flush = flush;
    status.loaded = true;
    if (autoFlushConfig) {
      setInterval(() => {
        status.flush();
      }, autoFlushConfig.interval);
    }
  }
}

type DirtyGraphCache = Map<string, DirtyEntityCache>;

interface DirtyEntityCache {
  seen: Set<string>;
  dirtyEntities: { id: string; type: 'set' | 'delete' }[];
}
interface FlushCommand {
  entityName: string;
  entities: (
    | { type: 'set'; entity: EntityWithIdAny }
    | { type: 'delete'; id: string }
  )[];
}

//this mutates the dirty graph cache which is kinda gross
function constructFlushCommands<S extends GraphSchemaAny>(
  dirtyGraphCache: DirtyGraphCache,
  graph: ValtioGraph<S>,
): FlushCommand[] {
  const commands: FlushCommand[] = [];
  for (const [name, entityCache] of dirtyGraphCache) {
    if (entityCache.dirtyEntities.length === 0) continue;
    const flushCommand: FlushCommand = {
      entityName: name,
      entities: [],
    };
    const viewIndex = graph.getViews().get(name)!;
    for (const dirtyEntity of entityCache.dirtyEntities) {
      if (dirtyEntity.type === 'delete') {
        flushCommand.entities.push({ type: 'delete', id: dirtyEntity.id });
        continue;
      }
      const entity = graph.get(name, dirtyEntity.id);
      if (!entity) continue;

      //do a shallow copy of the entity without the materialised refs
      const entityWithoutRefs = {} as EntityWithIdAny;
      for (const property in entity) {
        const fieldRel = viewIndex.fieldRelations.get(property);
        if (!fieldRel || fieldRel.type === 'source') {
          //this is a real field
          entityWithoutRefs[property] = entity[property];
        }
      }
      delete entityWithoutRefs['as'];
      //now we can snapshot just these fields, which should save us some effort over snapshotting the full entity,
      //because this is a snapshot it doesn't matter if the proxy is changed after the flush returns
      const entitySnapshot = snapshot(proxy(entityWithoutRefs));
      flushCommand.entities.push({
        type: 'set',
        entity: entitySnapshot,
      });
      if (flushCommand.entities.length > 0) {
        commands.push(flushCommand);
      }
      entityCache.dirtyEntities = [];
      entityCache.seen.clear();
    }
  }
  return commands;
}
