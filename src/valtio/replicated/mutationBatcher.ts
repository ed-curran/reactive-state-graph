import { EntityWithIdAny, Ref } from '../valtioGraph';
import { v1 as uuidv1 } from 'uuid';
import { EditCommand, ObjectWithId } from '../cachedStore';
import { GraphSchemaAny } from '../../core';
import { proxy, snapshot } from 'valtio/vanilla';

export type CreatedMutationChange<T extends EntityWithIdAny = EntityWithIdAny> =
  {
    readonly entitySnapshot: T;
  };

export type DeletedMutationChange = {};

//todo use readonly collections
export type UpdatedMutationChange = {
  readonly fields: Map<string, UpdatedField>;
};

interface MutationMetadata<N extends string = string> {
  readonly id: string;
  readonly order: number;
  readonly entityName: N;
  readonly entityId: string;
  readonly replicated: boolean;
}
export interface CreatedMutation<
  N extends string = string,
  T extends EntityWithIdAny = EntityWithIdAny,
> extends MutationMetadata<N> {
  readonly type: 'Create';
  readonly change: CreatedMutationChange<T>;
  readonly inverse: DeletedMutationChange;
}
export interface DeletedMutation<
  N extends string = string,
  T extends EntityWithIdAny = EntityWithIdAny,
> extends MutationMetadata<N> {
  readonly type: 'Delete';
  readonly change: DeletedMutationChange;
  readonly inverse: CreatedMutationChange<T>;
}

export interface UpdatedMutation<N extends string = string>
  extends MutationMetadata<N> {
  readonly type: 'Update';
  readonly change: UpdatedMutationChange;
  readonly inverse: UpdatedMutationChange;
}

export type Mutation<
  N extends string = string,
  T extends EntityWithIdAny = EntityWithIdAny,
> = CreatedMutation<N, T> | UpdatedMutation<N> | DeletedMutation<N, T>;
export type Content<T extends Mutation> = T extends Mutation
  ? Omit<T, 'id' | 'order' | 'entityName' | 'entityId' | 'replicated'>
  : never;

export type UpdatedFieldWithHistory = {
  readonly type: 'set' | 'delete';
  readonly path: (symbol | string)[];
  readonly value: unknown;
  readonly previousValue: unknown;
};

export type UpdatedField = {
  readonly type: 'set' | 'delete';
  readonly path: (symbol | string)[];
  readonly value: unknown;
};

export function makeCompositeEntityId(name: string, id: string) {
  return `${name}/${id}`;
}

type EntityIndex = {
  mutations: Set<string>;
  //its possible to have multiple updated mutations present per entity
  //this keep track of the latest one
  latestUpdatedMutation?: string;
  createdMutation?: string;
  deletedMutation?: string;
  confirmedSnapshot?: ObjectWithId;
};

type EntityCoords = {
  entityId: string;
  entityName: string;
};

export class MutationBatcher {
  //map keeps insertion order
  private readonly entitiesIndex: Map<string, EntityIndex>;
  private readonly mutationCache: Map<string, Mutation>;
  //this is used to track and flush changes
  private readonly edits: Map<string, EditCommand<Mutation>>;

  private order: number;

  constructor(readonly clientSeed: Uint8Array) {
    this.entitiesIndex = new Map();
    this.mutationCache = new Map();
    this.edits = new Map();
    this.order = 0;
  }

  generateUuid() {
    return uuidv1({ node: this.clientSeed });
  }

  public addDeleted(
    mark: Omit<DeletedMutation, 'id' | 'type' | 'order' | 'replicated'>,
  ) {
    const mutation: DeletedMutation = {
      id: this.generateUuid(),
      order: ++this.order,
      type: 'Delete',
      entityId: mark.entityId,
      entityName: mark.entityName,
      change: mark.change,
      inverse: mark.inverse,
      replicated: false,
    } as const;
    this.mutationCache.set(mutation.id, mutation);

    const index = this.getOrCreateIndex(mark);
    index.deletedMutation = mutation.id;

    this.setMutation(mutation, index);
  }

  public removeDeleted(id: string) {
    this.deleteMutation(id, (index) => {
      index.deletedMutation = undefined;
    });
  }

  public addCreated(
    mark: Omit<CreatedMutation, 'id' | 'type' | 'order' | 'replicated'>,
  ) {
    const mutation: CreatedMutation = {
      id: this.generateUuid(),
      order: ++this.order,
      type: 'Create',
      entityId: mark.entityId,
      entityName: mark.entityName,
      change: mark.change,
      inverse: mark.inverse,
      replicated: false,
    } as const;

    const index = this.getOrCreateIndex(mark);
    index.createdMutation = mutation.id;

    this.setMutation(mutation, index);
  }

  public removeCreated(id: string) {
    this.deleteMutation(id, (index) => {
      index.createdMutation = undefined;
    });
  }

  public addUpdatedField(
    mark: { entityId: string; entityName: string },
    fieldEntry: UpdatedFieldWithHistory,
    rel: {
      targetEntityName: string;
    } | null,
  ) {
    const index = this.getOrCreateIndex(mark);
    const pathId = fieldEntry.path.join('/');

    // we check a couple things decide whether we need to create a new mutation or merge into an existing one
    // 1. if no existing mutation exists for this entity, then obviously we create a new mutation
    // 2. if the field being updated is an outgoing relation, then we create a new mutation
    // 3. if we have an existing mutation for this entity, but it has already been replicated, then we create a new mutation
    // otherwise we can merge this update into the existing mutation
    const existingMutation = index.latestUpdatedMutation
      ? this.mutationCache.get(index.latestUpdatedMutation)
      : undefined;

    //need this to decide when the inverse is a delete
    const fieldHasBeenCreated =
      fieldEntry.type === 'set' && fieldEntry.previousValue === null;

    if (rel === null && existingMutation && !existingMutation.replicated) {
      //update existing mutation
      if (!existingMutation || existingMutation.type !== 'Update') {
        console.log(
          `warn: expected mutation ${index.latestUpdatedMutation} to exist in cache`,
        );
        return;
      }
      const existingField = existingMutation.change.fields.get(pathId);
      if (existingField) {
        existingMutation.change.fields.set(pathId, {
          type: fieldEntry.type,
          path: fieldEntry.path,
          value: fieldEntry.value,
        });
        //don't need to update inverse
      } else {
        existingMutation.change.fields.set(pathId, {
          type: fieldEntry.type,
          path: fieldEntry.path,
          value: fieldEntry.value,
        });
        const inverseFieldEntry: UpdatedField = {
          type: fieldHasBeenCreated ? 'delete' : 'set',
          path: fieldEntry.path,
          value: fieldEntry.previousValue,
        };
        existingMutation.inverse.fields.set(pathId, inverseFieldEntry);
      }
      //this is important to capture this as an edit to flush to disk
      this.setMutation(existingMutation, index);
    } else {
      const inverseFieldEntry: UpdatedField = {
        type: fieldHasBeenCreated ? 'delete' : 'set',
        path: fieldEntry.path,
        value: fieldEntry.previousValue,
      };

      const mutation: UpdatedMutation = {
        id: this.generateUuid(),
        order: ++this.order,
        type: 'Update',
        entityId: mark.entityId,
        entityName: mark.entityName,
        replicated: false,
        change: {
          fields: new Map([[pathId, fieldEntry]]),
        },
        inverse: {
          fields: new Map([[pathId, inverseFieldEntry]]),
        },
      } as const;
      index.latestUpdatedMutation = mutation.id;

      this.setMutation(mutation, index);
    }
  }

  public removeUpdated(id: string) {
    this.deleteMutation(id, (index) => {
      if (index.latestUpdatedMutation === id) {
        index.latestUpdatedMutation = undefined;
      }
    });
  }

  public markReplicated(id: string) {
    const mutation = this.mutationCache.get(id);
    if (mutation) this.mutationCache.set(id, { ...mutation, replicated: true });
  }

  public removeMutation(mutation: Mutation) {
    switch (mutation.type) {
      case 'Create': {
        this.removeCreated(mutation.id);
        break;
      }
      case 'Delete': {
        this.removeDeleted(mutation.id);
        break;
      }
      case 'Update': {
        this.removeUpdated(mutation.id);
        break;
      }
    }
  }

  private getOrCreateIndex(coords: {
    entityId: string;
    entityName: string;
  }): EntityIndex {
    const compositeEntityId = makeCompositeEntityId(
      coords.entityName,
      coords.entityId,
    );
    const existing = this.entitiesIndex.get(compositeEntityId);
    if (existing) return existing;
    const created: EntityIndex = {
      mutations: new Set<string>(),
    };
    this.entitiesIndex.set(compositeEntityId, created);
    return created;
  }

  private setMutation(mutation: Mutation, index: EntityIndex) {
    index.mutations.add(mutation.id);
    this.mutationCache.set(mutation.id, mutation);
    this.edits.set(mutation.id, {
      type: 'Set',
      id: mutation.id,
      value: mutation,
    });
  }

  private deleteMutation(
    id: string,
    indexClearFunc: (index: EntityIndex) => void,
  ) {
    const mutation = this.mutationCache.get(id);
    if (!mutation) return;

    const index = this.getOrCreateIndex(mutation);
    indexClearFunc(index);
    index.mutations.delete(mutation.id);
    if (index.mutations.size === 0) {
      this.entitiesIndex.delete(mutation.entityId);
    }
    this.mutationCache.delete(mutation.id);
    this.edits.set(mutation.id, {
      type: 'Delete',
      id: mutation.id,
    });
  }

  public flushEdits() {
    const edits = Array.from(this.edits.values());
    this.edits.clear();
    return edits;
  }

  public rebaseEdits(edits: EditCommand<Mutation>[]) {
    for (const edit of edits) {
      //if we don't already have an edit for this mutation, then we add it
      if (!this.edits.has(edit.id)) this.edits.set(edit.id, edit);
    }
  }

  public clearEdits() {
    this.edits.clear();
  }

  public seedMutation(mutation: Mutation) {
    switch (mutation.type) {
      case 'Create': {
        const index = this.getOrCreateIndex(mutation);
        index.createdMutation = mutation.id;
        this.setMutation(mutation, index);
        break;
      }
      case 'Delete': {
        const index = this.getOrCreateIndex(mutation);
        index.deletedMutation = mutation.id;
        this.setMutation(mutation, index);
        break;
      }
      case 'Update': {
        const index = this.getOrCreateIndex(mutation);
        index.latestUpdatedMutation = mutation.id;
        this.setMutation(mutation, index);
        break;
      }
    }
    if (mutation.order > this.order) this.order = mutation.order;
  }

  public seed(mutations: Mutation[]) {
    for (const mutation of mutations) {
      switch (mutation.type) {
        case 'Create': {
          const index = this.getOrCreateIndex(mutation);
          index.createdMutation = mutation.id;
          this.setMutation(mutation, index);
          break;
        }
        case 'Delete': {
          const index = this.getOrCreateIndex(mutation);
          index.deletedMutation = mutation.id;
          this.setMutation(mutation, index);
          break;
        }
        case 'Update': {
          const index = this.getOrCreateIndex(mutation);
          index.latestUpdatedMutation = mutation.id;
          this.setMutation(mutation, index);
          break;
        }
      }
    }
    this.order = mutations[mutations.length - 1]!.order;
  }

  public getByEntity(coords: {
    readonly entityId: string;
    readonly entityName: string;
  }): Mutation[] | undefined {
    const compositeEntityId = makeCompositeEntityId(
      coords.entityName,
      coords.entityId,
    );
    const existing = this.entitiesIndex.get(compositeEntityId);
    if (!existing) return undefined;

    const mutations: Mutation[] = [];
    //this is in insertion order, whiiich should be fine
    //but maybe we should sort by order explicitly
    for (const mutationId of existing.mutations) {
      const mutation = this.mutationCache.get(mutationId);
      if (mutation) {
        mutations.push(mutation);
      }
    }

    return mutations;
  }

  public getMutation(mutationId: string) {
    return this.mutationCache.get(mutationId);
  }

  public getMutations() {
    return this.mutationCache;
  }
}

function constructJsonPatchObject(
  updatedFields: UpdatedField[],
): Record<string, unknown> {
  const patch = {};
  for (const updatedField of updatedFields) {
    setDeep(
      updatedField.path,
      updatedField.type === 'set' ? updatedField.value : null,
      patch,
    );
  }
  return patch;
}

export function constructPatchObjectFromUpdatedFields(
  updatedFields: Map<string, UpdatedField>,
): Record<string, unknown> {
  const patch = {};
  for (const [pathId, updatedField] of updatedFields) {
    setDeep(
      updatedField.path,
      updatedField.type === 'set' ? updatedField.value : null,
      patch,
    );
  }
  return patch;
}

function setDeep(
  path: (symbol | string)[],
  value: any,
  parent: Record<string | symbol, unknown>,
) {
  const childPath = path[0];
  if (!childPath) return; //shouldn't happen
  if (path.length === 1) {
    //found a leaf so set the value on the parent at the specified path
    parent[childPath] = value;
  } else {
    setDeep(
      path.slice(1, path.length),
      value,
      (parent[childPath] as Record<string | symbol, unknown>) ?? {},
    );
  }
}

export function toUpdatedMutationContent(
  fields: UpdatedFieldWithHistory[],
): Content<UpdatedMutation> {
  const normal: UpdatedField[] = fields.map((field) => ({
    type: field.type,
    path: field.path,
    value: field.value,
  }));
  const inverse: UpdatedField[] = fields.map((field) => ({
    type: field.type === 'delete' ? 'set' : 'set',
    path: field.path,
    value: field.previousValue,
  }));

  return {
    type: 'Update',
    change: {
      fields: new Map(normal.map((field) => [field.path.join('/'), field])),
    },
    inverse: {
      fields: new Map(inverse.map((field) => [field.path.join('/'), field])),
    },
  } as const;
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

// export type DeletedEntity = { type: 'Deleted'; id: string };
// export type CreatedEntity = { type: 'Created'; id: string };
// export type UpdatedEntity = {
//   type: 'Updated';
//   id: string;
//   confirmedSnapshot: ObjectWithId;
// };
//
// export type DirtyEntity = CreatedEntity | DeletedEntity | UpdatedEntity;
//
// export class EntityRebaser {
//   //map keeps insertion order
//   private readonly dirtyEntities: Map<
//     string,
//     {
//       confirmed: ObjectWithId;
//     }
//   >;
//   private readonly mutationCache: Map<string, Mutation>;
//   //this is used to track and flush changes
//   private readonly edits: Map<string, EditCommand<ObjectWithId>>;
//
//   public addDirtyEntity(
//     entityName: string,
//     entityId: string,
//     entityProxy: ObjectWithId,
//   ) {
//     const existing = this.dirtyEntities.get(
//       makeCompositeEntityId(entityName, entityId),
//     );
//     if (!existing) {
//     }
//   }
// }
