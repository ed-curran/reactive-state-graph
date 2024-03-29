import { EntityWithIdAny, Ref, ValtioGraph } from '../valtioGraph';
import {
  DiscriminatedEntityWithId,
  GraphSchemaAny,
  InferDiscriminatedEntityWithId,
  InferPoolEntityName,
  InferPoolEntityWithId,
  InferPoolModel,
  ModelAny,
  PoolSchemaAny,
} from '../../core';
import { openDB } from 'idb';
import { proxy, snapshot, subscribe } from 'valtio/vanilla';
import { keyFromArrayMapPath, proxyArrayMap } from '../proxyArrayMap';
import { mergePatch } from '../mergePatch';
import { EditCommand, editStore } from '../cachedStore';
import {
  MutationBatcher,
  Mutation,
  makeCompositeEntityId,
  Content,
  constructPatchObjectFromUpdatedFields,
} from './mutationBatcher';
import { mergeToRebasedAndConfirmedMutation } from './mergeMutation';
import { ValtioPool } from '../valtioPool';
import { mergeToInverseMutation } from './mergeInverseMutation';
import { Client, makeClient } from './client';

export interface PersistReplicatedOptions<T extends TypedMutationAny> {
  name: string;
  version: number;
  replicator: MutationReplicator<T>;
  autoFlush?:
    | {
        interval: number;
      }
    | false;
  mutationsTableName?: string;
  clientTableName?: string;
}

interface EntityPersistStatus {
  loaded: boolean;
}

type TypedMutation<T extends DiscriminatedEntityWithId> = T extends any
  ? Mutation<T['name'], T['entity']>
  : never;
type TypedMutationAny = TypedMutation<DiscriminatedEntityWithId>;
type InferGraphTypedMutation<S extends GraphSchemaAny> = TypedMutation<
  InferPoolEntityWithId<S['poolSchema']>
>;

interface GraphPersistStatus<T extends TypedMutationAny> {
  loaded: boolean;
  flush: () => Promise<void>;
  receiveMutation: (mutation: T, offset: number) => void;
  latestOffset: () => number;
  //root: EntityPersistStatus
}

type MutationReplicator<T extends TypedMutationAny> = (
  mutation: T,
  latestOffset: number,
) => Promise<boolean>;

export function persistGraphReplicated<S extends GraphSchemaAny>(
  graph: ValtioGraph<S>,
  options: PersistReplicatedOptions<InferGraphTypedMutation<S>>,
): GraphPersistStatus<InferGraphTypedMutation<S>> {
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
    receiveMutation: () => {
      throw Error('graph not initialised');
    },
    latestOffset: () => {
      throw Error('client not initialised');
    },
  });

  doPersistGraphReplicated(graph, options, status);
  return status;
}

const DEFAULT_TRANSACTIONS_TABLE_NAME = '_transactions';
const DEFAULT_CLIENT_TABLE_NAME = '_client';
const DEFAULT_CLIENT_KEY = '_client';

async function doPersistGraphReplicated<S extends GraphSchemaAny>(
  graph: ValtioGraph<S>,
  options: PersistReplicatedOptions<InferGraphTypedMutation<S>>,
  status: GraphPersistStatus<InferGraphTypedMutation<S>>,
) {
  const mutationsTableName =
    options.mutationsTableName ?? DEFAULT_TRANSACTIONS_TABLE_NAME;
  const clientTableName = options.clientTableName ?? DEFAULT_CLIENT_TABLE_NAME;
  const db = await openDB(options.name, options.version, {
    upgrade(db, oldVersion, newVersion, transaction, event) {
      for (const [name, viewIndex] of graph.getViews()) {
        //todo: configurable id field
        db.createObjectStore(name, {
          keyPath: 'id',
        });
      }
      db.createObjectStore(mutationsTableName, {
        keyPath: 'id',
      });
      db.createObjectStore(clientTableName);

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

  //first load or create client
  console.log(graph.getPool().getState().getEntityTables());
  const clientTx = db.transaction(clientTableName, 'readwrite');
  const createClient = async () => {
    const client = makeClient();
    await clientTx.store.put(client, DEFAULT_CLIENT_KEY);
    return client;
  };
  const client =
    ((await clientTx.store.get(DEFAULT_CLIENT_KEY)) as Client | undefined) ??
    (await createClient());
  await clientTx.done;

  //then load all entities into graph
  const tx = db.transaction([
    ...graph.getSchema().views.map((view) => view.model.name),
    graph.getSchema().rootView.model.name,
    mutationsTableName,
    clientTableName,
  ]);

  for (const [name, viewIndex] of graph.getViews()) {
    //get all is faster than cursors
    //so we use it and try to avoid having two copies of all the entities
    if (name === graph.getSchema().rootView.model.name) {
      const store = tx.objectStore(name);
      const entities = (await store.getAll()) as EntityWithIdAny[];

      for (const entity of entities) {
        graph.getPool().createRoot(entity);
      }
    } else {
      const store = tx.objectStore(name);
      const entities = (await store.getAll()) as EntityWithIdAny[];
      for (const entity of entities) {
        graph.getPool().createEntityMutable({ name, entity });
      }
    }
  }
  //then apply all mutations to graph
  const mutationBatcher = new MutationBatcher(client.seed);

  const mutationsStore = tx.objectStore(mutationsTableName);
  const mutations = (await mutationsStore.getAll()) as Mutation[];
  for (const mutation of mutations) {
    mutationBatcher.seedMutation(mutation);
    console.log('seeded mutation');
    console.log(mutation);
    applyMutationToPool(
      graph.getPool(),
      mutation.entityName,
      mutation.entityId,
      mutation,
    );
  }

  //wait for the graph state to be initialised
  //if this fails then let it error
  await tx.done;

  //then materialise them to resolve references
  for (const [name, viewIndex] of graph.getViews()) {
    const entities = graph.getPool().getState().getEntityTable(name);
    for (const [entityId, entity] of entities.data) {
      graph.materialiseEntity(name, entity);
    }
  }

  let trackGraphChanges = true;
  const enableTracking = async () => {
    await Promise.resolve();
    trackGraphChanges = true;
  };
  const disableTracking = async () => {
    await Promise.resolve();
    trackGraphChanges = false;
  };

  const flush = () => {
    //console.log('flushing');
    //this also clears the edits so subsequent flushes won't retry them
    const mutationEdits = mutationBatcher.flushEdits();
    //console.log(mutationEdits);
    if (!mutationEdits) return Promise.resolve();
    const tx = db.transaction(mutationsTableName, 'readwrite');
    editStore(mutationEdits, tx.store);
    return tx.done.catch(() => {
      //something went wrong, so reinsert the edits so that they will get reflushed later
      //we may have collected edits since this flush was initiated, so this takes care of rebasing those on top.
      mutationBatcher.rebaseEdits(mutationEdits);
    });
  };

  const replicate = async (
    handle: (
      mutation: InferGraphTypedMutation<S>,
      number: number,
    ) => Promise<boolean>,
  ) => {
    //attempt to commit each mutation to remote
    //and collect the results grouped by entity
    const groupedResults = new Map<
      string,
      {
        entityName: string;
        entityId: string;
        mutationResults: {
          result: 'accepted' | 'rejected';
          mutation: Mutation;
        }[];
      }
    >();
    for (const [id, pendingMutation] of mutationBatcher.getMutations()) {
      //this mutation has already been replicated (we're just waiting for it to be mirrored back to us)
      if (pendingMutation.replicated) continue;
      try {
        const accepted = await handle(
          pendingMutation as InferGraphTypedMutation<S>,
          client.latestOffset,
        ); //nice
        const compositeEntityId = makeCompositeEntityId(
          pendingMutation.entityId,
          pendingMutation.entityName,
        );
        let entityIndex = groupedResults.get(compositeEntityId);
        if (!entityIndex) {
          entityIndex = {
            entityName: pendingMutation.entityName,
            entityId: pendingMutation.entityId,
            mutationResults: [],
          };
          groupedResults.set(compositeEntityId, entityIndex);
        }
        const result = accepted ? 'accepted' : 'rejected';
        entityIndex.mutationResults.push({
          result: result,
          mutation: pendingMutation,
        });
        //if the mutation was rejected then remove it from pending mutations
        if (accepted) {
          mutationBatcher.markReplicated(pendingMutation.id);
        } else {
          mutationBatcher.removeMutation(pendingMutation);
        }
      } catch (e) {
        // do nothing and will retry it later
      }
    }
    const rollbackMutations: Mutation[] = [];

    for (const [compositeEntityId, groupedResultsEntry] of groupedResults) {
      const rollbackMutationContent = mergeToInverseMutation(
        groupedResultsEntry.mutationResults,
      );
      if (rollbackMutationContent) {
        console.log('rollback');
        const rollbackMutation = {
          entityName: groupedResultsEntry.entityName,
          entityId: groupedResultsEntry.entityId,

          type: rollbackMutationContent.type,
          change: rollbackMutationContent.change,
          inverse: rollbackMutationContent.inverse,

          //useless
          id: '1',
          order: 0,
        } as Mutation;
        console.log(rollbackMutation);
        rollbackMutations.push(rollbackMutation);
      }
    }
    //these awaits are important to force valtios batched updates to flush
    await disableTracking();
    for (const rollbackMutation of rollbackMutations) {
      applyMutationToPool(
        graph.getPool(),
        rollbackMutation.entityName,
        rollbackMutation.entityId,
        rollbackMutation,
      );
    }
    for (const rollbackMutation of rollbackMutations) {
      materialiseMutation(
        graph,
        rollbackMutation.entityName,
        rollbackMutation.entityId,
        rollbackMutation,
      );
    }
    await enableTracking();
  };

  const receiveMutation = async (mutation: Mutation, offset: number) => {
    const entityId = mutation.entityId;
    const entityName = mutation.entityName;
    const entityView = graph.getViews().get(mutation.entityName);
    if (!entityView) {
      console.log('got unknown mutation');
      return;
    }
    const pendingMutations =
      mutationBatcher.getByEntity({
        entityId: mutation.entityId,
        entityName: mutation.entityName,
      }) ?? [];

    //need to do two things
    //1. figure out the confirmed state of the entity and flush it to the db
    //2. update the current state of the entity to match the pending mutations rebased on top of the confirmed state
    //this function gives us two mutations that can be applied to the entity to do just that

    const combined = mergeToRebasedAndConfirmedMutation(
      mutation,
      pendingMutations,
    );
    const entityProxy = graph.get(mutation.entityName, mutation.entityId);
    const currentSnapshot = entityProxy
      ? snapshotWithoutRefs(entityProxy, entityView.fieldRelations)
      : undefined;

    //construct and flush the confirmed state of the entity
    console.log(currentSnapshot);
    const confirmedSnapshot = applyMutationToSnapshot(
      currentSnapshot,
      combined.toConfirmed,
    );

    const entityEditCommand = maybeSnapshotToEditCommand(
      entityId,
      confirmedSnapshot,
    );

    if (entityEditCommand) {
      console.log('flushing entity');
      console.log(entityEditCommand);
      console.log(entityName);
      const tx = db.transaction([entityName, clientTableName], 'readwrite');
      editStore([entityEditCommand], tx.objectStore(entityName));
      //update offset
      const clientStore = tx.objectStore(clientTableName);
      if (offset > client.latestOffset) client.latestOffset = offset;
      await clientStore.put(client, DEFAULT_CLIENT_KEY);

      await tx.done;
    } else {
      //update offset
      const tx = db.transaction(clientTableName, 'readwrite');
      const clientStore = tx.store;
      if (offset > client.latestOffset) {
        client.latestOffset = offset;
      }
      await clientStore.put(client, DEFAULT_CLIENT_KEY);

      await tx.done;
    }
    //remove this mutation from the uncommitted mutations
    const ackedMutation = mutationBatcher.getMutation(mutation.id);
    if (ackedMutation) {
      console.log('removing mutation');
      mutationBatcher.removeMutation(ackedMutation);
    }

    //perform the rebase to the graph
    if (combined.toRebased) {
      console.log('rebase');
      console.log(combined.toRebased);
      await disableTracking();
      applyMutationToPool(
        graph.getPool(),
        entityName,
        entityId,
        combined.toRebased,
      );
      materialiseMutation(graph, entityName, entityId, combined.toRebased);
      await enableTracking();
    }

    return Promise.resolve();
  };

  //then subscribe to keep track of which entities have changed and need flushed
  //we use a seperate subscribe than the one used in the graph to watch references
  //because this will contain all the reference changes batched together, so should get called less frequently
  for (const [name, viewIndex] of graph.getViews()) {
    const entityTable = graph.getPool().getState().getEntityTable(name);
    subscribe(entityTable, (ops) => {
      if (!trackGraphChanges) {
        console.log('skipped tracking');
        return;
      }
      for (const change of ops) {
        const [op, path, current, prev] = change;
        if (path.length < 2) {
          //entity pool itself has been replaced (this would happen on initialising the pool?)
        } else if (path.length === 2) {
          //entity in pool replaced (this happens on entity create and delete)
          const entityId = keyFromArrayMapPath(entityTable, path);
          const entityProxy = (current as [string, EntityWithIdAny])[1];
          if (op === 'delete') {
            //it's possible to have one set and multiple deletes for the same entity,
            //but deletes should be rare so I think it's fine
            mutationBatcher.addDeleted({
              entityId: entityId,
              entityName: name,
              inverse: {
                entitySnapshot: snapshotWithoutRefs(
                  entityProxy,
                  viewIndex.fieldRelations,
                ),
              },
              change: {},
            });
          } else if (op === 'set') {
            console.log('set op');
            const snapshot = snapshotWithoutRefs(
              entityProxy,
              viewIndex.fieldRelations,
            );

            mutationBatcher.addCreated({
              entityId: entityId,
              entityName: name,
              change: {
                entitySnapshot: snapshot,
              },
              inverse: {},
            });
          }
        } else if (path.length === 3) {
          //an existing entity has been replaced (probably shouldn't happen)
        } else if (path.length > 3) {
          //field in entity has been changed
          const fieldName = path[3] as string;

          //if this is a materialised ref field then ignore the change it
          const fieldRel = viewIndex.fieldRelations.get(fieldName);
          if (op !== 'set' && op !== 'delete') {
            continue;
          }
          if (fieldRel && fieldRel.type !== 'source') {
            continue;
          }
          //changed field path relative to the entity
          const entityPath = path.slice(3, path.length);
          //a real field changed, find the entity that changed
          const entityId = keyFromArrayMapPath(entityTable, path);

          //don't care if its a set or a delete,
          //treat them both as entity level set
          mutationBatcher.addUpdatedField(
            {
              entityName: name,
              entityId,
            },
            { path: entityPath, value: current, previousValue: prev, type: op },
            fieldRel
              ? { targetEntityName: fieldRel.relation.target.type }
              : null,
          );
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
    status.receiveMutation = receiveMutation;
    status.latestOffset = () => {
      return client.latestOffset;
    };
    status.loaded = true;
    if (autoFlushConfig) {
      setInterval(() => {
        replicate(options.replicator).then(() => {
          status.flush();
        });
      }, autoFlushConfig.interval);
    }
  }
}

function snapshotWithoutRefs(
  entity: EntityWithIdAny,
  fieldRelations: Map<string, Ref<GraphSchemaAny>>,
) {
  const entityWithoutRefs = {} as EntityWithIdAny;

  for (const property in entity) {
    const fieldRel = fieldRelations.get(property);
    if (!fieldRel || fieldRel.type === 'source') {
      //this is a real field
      entityWithoutRefs[property] = entity[property];
    }
  }
  delete entityWithoutRefs['as'];
  //now we can snapshot just these fields, which should save us some effort over snapshotting the full entity,
  //because this is a snapshot it doesn't matter if the proxy is changed after the flush returns
  //todo: should reuse the proxy
  return snapshot(proxy(entityWithoutRefs));
}

function applyMutationToPool<S extends PoolSchemaAny>(
  pool: ValtioPool<S>,
  entityName: string,
  entityId: string,
  mutation: Content<Mutation>,
) {
  const rootModelName = pool.getSchema().rootModel.name;
  switch (mutation.type) {
    case 'Create': {
      if (entityName === rootModelName) {
        pool.createRoot(mutation.change.entitySnapshot);
      } else {
        pool.createEntity({
          name: entityName,
          entity: mutation.change.entitySnapshot,
        });
      }
      break;
    }
    case 'Delete': {
      if (entityName === rootModelName) {
        pool.deleteRoot();
      } else {
        pool.deleteEntity(entityName, entityId);
      }
      break;
    }
    case 'Update': {
      //gross
      const entityProxy = pool.getEntity(entityName, entityId);
      if (!entityProxy) {
        console.log(
          'transaction tried to update entity which does not exist, not sure why this would happen',
        );
        break;
      }
      const patch = constructPatchObjectFromUpdatedFields(
        mutation.change.fields,
      );
      mergePatch(entityProxy, patch);
      break;
    }
  }
}

function applyMutationToSnapshot(
  snapshot: EntityWithIdAny | undefined,
  mutation: Content<Mutation> | undefined,
): EntityWithIdAny | undefined {
  if (mutation === undefined) return snapshot;
  switch (mutation.type) {
    case 'Create': {
      return mutation.change.entitySnapshot;
    }
    case 'Delete': {
      return undefined;
    }
    case 'Update': {
      const patch = constructPatchObjectFromUpdatedFields(
        mutation.change.fields,
      );
      if (!snapshot) return undefined;
      //snapshot fields are readonly
      const updated = structuredClone(snapshot);
      mergePatch(updated, patch);
      return updated;
    }
  }
}

function mutationToEditCommand(
  mutation: Mutation,
  snapshot: EntityWithIdAny | undefined,
): EditCommand<EntityWithIdAny> | undefined {
  switch (mutation.type) {
    case 'Create':
    case 'Update': {
      if (!snapshot) return undefined;
      return {
        type: 'Set',
        id: mutation.entityId,
        value: snapshot,
      };
    }
    case 'Delete': {
      return {
        type: 'Delete',
        id: mutation.entityId,
      };
    }
  }
}

function materialiseMutation<S extends GraphSchemaAny>(
  graph: ValtioGraph<S>,
  entityName: string,
  entityId: string,
  mutation: Content<Mutation>,
) {
  const entity = graph.get(entityName, entityId);
  if (!entity) return;

  switch (mutation.type) {
    case 'Create': {
      graph.materialiseEntity(entityName, entity, undefined, undefined);
      break;
    }
    case 'Update': {
      graph.materialiseEntity(
        entityName,
        entity,
        mutation.change.fields,
        mutation.inverse.fields,
      );
      break;
    }
    case 'Delete': {
      graph.dematerialiseEntity(entityName, entity);
      break;
    }
  }
}

function maybeSnapshotToEditCommand(
  entityId: string,
  snapshot: EntityWithIdAny | undefined,
): EditCommand<EntityWithIdAny> | undefined {
  if (snapshot) {
    return {
      type: 'Set',
      id: snapshot.id,
      value: snapshot,
    };
  }
  return {
    type: 'Delete',
    id: entityId,
  };
}

function materialiseEntities<S extends GraphSchemaAny>(
  graph: ValtioGraph<S>,
  affectedEntities: {
    entityName: InferPoolEntityName<S['poolSchema']>;
    entityProxy: EntityWithIdAny;
    mutation: Mutation;
  }[],
) {
  for (const affectedEntity of affectedEntities) {
    graph.materialiseEntity(
      affectedEntity.entityName,
      affectedEntity.entityProxy,
    );
  }
}
