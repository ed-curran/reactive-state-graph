import {
  constructPatchObjectFromUpdatedFields,
  Content,
  CreatedMutation,
  DeletedMutation,
  Mutation,
  UpdatedField,
  UpdatedMutation,
} from './mutationBatcher';
import { mergePatch } from '../mergePatch';
import { EntityWithIdAny } from '../valtioGraph';
function mergeCreateWithUpdate(
  agg: Content<CreatedMutation>,
  mutation: Content<UpdatedMutation>,
): Content<Mutation> {
  return {
    type: 'Create',
    change: {
      entitySnapshot: mergePatch(
        agg.change.entitySnapshot,
        constructPatchObjectFromUpdatedFields(mutation.inverse.fields),
      ) as EntityWithIdAny,
    },
    inverse: {},
  };
}

function mergeWithCreated(
  agg: Content<CreatedMutation>,
  mutation: Content<Mutation>,
): Content<Mutation> | undefined {
  switch (mutation.type) {
    case 'Create': {
      //create shouldn't happen after update
      //so ignore this by passing through agg unchanged
      return agg;
    }
    case 'Update': {
      return mergeCreateWithUpdate(agg, mutation);
    }
    case 'Delete': {
      //this delete cancels out the existing create
      return undefined;
    }
  }
}

function mergeWithUpdated(
  agg: Content<UpdatedMutation>,
  mutation: Content<Mutation>,
): Content<Mutation> | undefined {
  switch (mutation.type) {
    case 'Create': {
      //create shouldn't happen after update
      //so ignore this by passing through agg unchanged
      return agg;
    }
    case 'Update': {
      //type hacks ew
      return mergeUpdatedWithUpdated(agg, mutation);
    }
    case 'Delete': {
      return mergeUpdatedWithDeleted(agg, mutation);
    }
  }
}

function mergeUpdatedWithUpdated(
  agg: Content<UpdatedMutation>,
  mutation: Content<UpdatedMutation>,
): Content<UpdatedMutation> {
  //we want to overrite the fields in agg with fields in mutation
  const combined = new Map(agg.change.fields);
  for (const [path, updatedField] of mutation.change.fields) {
    combined.set(path, updatedField);
  }

  //for inverse want to do the opposite: overwrite the fields in mutation with fields in agg
  const combinedInverse = new Map(mutation.inverse.fields);
  for (const [path, updatedField] of agg.inverse.fields) {
    combinedInverse.set(path, updatedField);
  }

  return {
    type: 'Update',
    change: {
      fields: combined,
    },
    inverse: {
      fields: combinedInverse,
    },
  };
}

function mergeUpdatedWithDeleted(
  agg: Content<UpdatedMutation>,
  mutation: Content<DeletedMutation>,
): Content<Mutation> {
  return {
    type: 'Delete',
    inverse: {
      entitySnapshot: mergePatch(
        mutation.inverse.entitySnapshot,
        constructPatchObjectFromUpdatedFields(agg.inverse.fields),
      ) as EntityWithIdAny,
    },
    change: {},
  };
}

function mergeWithDeleted(
  agg: Content<DeletedMutation>,
  mutation: Content<Mutation>,
): Content<Mutation> | undefined {
  //shouldn't have any other mutations after a delete
  //but if we do, treat them like they're for a new entity
  switch (mutation.type) {
    case 'Create': {
      //create shouldn't happen after update
      //so ignore this by passing through agg unchanged
      return mergeDeletedWithCreated(agg, mutation);
    }
    case 'Update': {
      //type hacks ew
      return agg;
    }
    case 'Delete': {
      return agg;
    }
  }
}

function mergeDeletedWithCreated(
  agg: Content<DeletedMutation>,
  mutation: Content<CreatedMutation>,
): Content<Mutation> {
  //we could create a more efficient patch by diffing agg with mutation
  //but i don't think its worth it because I don't even know when this case would happen
  return {
    type: 'Update',
    change: {
      fields: objectToUpdatedFields(mutation.change.entitySnapshot),
    },
    inverse: {
      fields: objectToUpdatedFields(agg.inverse.entitySnapshot),
    },
  };
}

function objectToUpdatedFields(
  a: Record<string, any>,
): Map<string, UpdatedField> {
  const fields = new Map<string, UpdatedField>();
  for (const key in a) {
    fields.set(key, {
      type: 'set',
      path: [key],
      value: a[key],
    });
  }
  return fields;
}

function merge(
  agg: Content<Mutation> | undefined,
  mutation: Content<Mutation> | undefined,
): Content<Mutation> | undefined {
  if (mutation === undefined) {
    return agg;
  }
  if (agg === undefined) {
    return mutation;
  }
  switch (agg.type) {
    case 'Update': {
      return mergeWithUpdated(agg, mutation);
    }
    case 'Delete': {
      return mergeWithDeleted(agg, mutation);
    }
    case 'Create': {
      return mergeWithCreated(agg, mutation);
    }
  }
}

export function mergeAll(
  mutations: (Content<Mutation> | undefined)[],
): Content<Mutation> | undefined {
  return mutations.reduce(merge, undefined);
}

export function mergeToRebaseMutation(
  confirmedMutation: Content<Mutation>,
  pendingMutations: Content<Mutation>[],
) {
  const pending = mergeAll(pendingMutations);
  const invertPending = pending && invertMutation(pending);
  return mergeAll([invertPending, confirmedMutation, pending]);
}

export function mergeToRebasedAndConfirmedMutation(
  confirmedMutation: Content<Mutation>,
  pendingMutations: Content<Mutation>[],
): {
  toConfirmed: Content<Mutation> | undefined;
  toRebased: Content<Mutation> | undefined;
} {
  const pending = mergeAll(pendingMutations);
  const invertPending = pending && invertMutation(pending);
  const confirmed = merge(invertPending, pending);
  return {
    toConfirmed: confirmed,
    toRebased: merge(confirmed, pending),
  };
}

export function mergeToConfirmedMutation(
  confirmedMutation: Content<Mutation>,
  pendingMutations: Content<Mutation>[],
) {
  const pending = mergeAll(pendingMutations);
  const invertPending = pending && invertMutation(pending);
  return mergeAll([invertPending, confirmedMutation, pending]);
}

export function invertMutation(mutation: Content<Mutation>): Content<Mutation> {
  switch (mutation.type) {
    case 'Create': {
      return {
        type: 'Delete',
        change: mutation.inverse,
        inverse: mutation.change,
      };
    }
    case 'Update': {
      return {
        type: 'Update',
        change: mutation.inverse,
        inverse: mutation.change,
      };
    }
    case 'Delete': {
      return {
        type: 'Create',
        change: mutation.inverse,
        inverse: mutation.change,
      };
    }
  }
}
