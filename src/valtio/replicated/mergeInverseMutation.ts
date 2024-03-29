import {
  constructPatchObjectFromUpdatedFields,
  Content,
  CreatedMutation,
  DeletedMutation,
  Mutation,
  UpdatedMutation,
} from './mutationBatcher';
import { mergePatch } from '../mergePatch';
import { EntityWithIdAny } from '../valtioGraph';

function mergeWithNone(mutationResult: {
  result: 'accepted' | 'rejected';
  mutation: Content<Mutation>;
}): Content<Mutation> | undefined {
  if (mutationResult.result === 'accepted') {
    return undefined;
  } else {
    return invertMutation(mutationResult.mutation);
  }
}

function mergeWithCreated(
  agg: Content<CreatedMutation>,
  mutationResult: {
    result: 'accepted' | 'rejected';
    mutation: Content<Mutation>;
  },
): Content<Mutation> | undefined {
  const mutation = mutationResult.mutation;
  switch (mutation.type) {
    case 'Create': {
      //create shouldn't happen after update
      //so ignore this by passing through agg unchanged
      return agg;
    }
    case 'Update': {
      //weird stuff
      return {
        type: 'Create',
        change: {
          //apply the inverse update to the create
          entitySnapshot: mergePatch(
            agg.change.entitySnapshot,
            constructPatchObjectFromUpdatedFields(mutation.inverse.fields),
          ) as EntityWithIdAny,
        },
        inverse: {},
      };
    }
    case 'Delete': {
      if (mutationResult.result === 'accepted') {
        //if the delete succeeded then the current agg doesn't matter
        return undefined;
      } else {
        //deletion got rejected so invert it
        return {
          type: 'Create',
          change: mutation.inverse,
          inverse: mutation.change,
        };
      }
    }
  }
}

type MutationResult<T> = {
  result: 'accepted' | 'rejected';
  mutation: T;
};
function mergeWithUpdated(
  agg: Content<UpdatedMutation>,
  mutationResult: MutationResult<Content<Mutation>>,
): Content<Mutation> | undefined {
  const mutation = mutationResult.mutation;
  switch (mutation.type) {
    case 'Create': {
      //create shouldn't happen after update
      //so ignore this by passing through agg unchanged
      return agg;
    }
    case 'Update': {
      //type hacks ew
      return mergeUpdatedWithUpdated(
        agg,
        mutationResult as MutationResult<Content<UpdatedMutation>>,
      );
    }
    case 'Delete': {
      if (mutationResult.result === 'accepted') {
        //if the delete succeeded then the current agg doesn't matter
        return undefined;
      } else {
        //deletion got rejected so invert it
        return {
          type: 'Create',
          change: mutation.inverse,
          inverse: mutation.change,
        };
      }
    }
  }
}

function mergeUpdatedWithUpdated(
  agg: Content<UpdatedMutation>,
  mutationResult: MutationResult<Content<UpdatedMutation>>,
): Content<Mutation> {
  if (mutationResult.result === 'accepted') {
    for (const [path, updatedField] of mutationResult.mutation.change.fields) {
      agg.change.fields.delete(path);
    }
    for (const [path, updatedField] of mutationResult.mutation.inverse.fields) {
      agg.change.fields.delete(path);
    }

    return agg;
  } else {
    for (const [path, updatedField] of mutationResult.mutation.inverse.fields) {
      agg.change.fields.set(path, updatedField);
    }
    for (const [path, updatedField] of mutationResult.mutation.change.fields) {
      agg.inverse.fields.set(path, updatedField);
    }

    return agg;
  }
}

function mergeWithDeleted(
  agg: Content<DeletedMutation>,
  mutationResult: {
    result: 'accepted' | 'rejected';
    mutation: Content<Mutation>;
  },
): Content<Mutation> | undefined {
  //shouldn't have any other mutations after a delete
  //but if we do, treat them like they're for a new entity
  return agg;
}

function merge(
  agg: Content<Mutation> | undefined,
  mutationResult: {
    result: 'accepted' | 'rejected';
    mutation: Content<Mutation>;
  },
): Content<Mutation> | undefined {
  if (agg === undefined) {
    return mergeWithNone(mutationResult);
  }
  switch (agg.type) {
    case 'Update': {
      return mergeWithUpdated(agg, mutationResult);
    }
    case 'Delete': {
      return mergeWithDeleted(agg, mutationResult);
    }
    case 'Create': {
      return mergeWithCreated(agg, mutationResult);
    }
  }
}
export function mergeToInverseMutation(
  mutationResults: {
    result: 'accepted' | 'rejected';
    mutation: Content<Mutation>;
  }[],
): Content<Mutation> | undefined {
  let inverseMutation: Content<Mutation> | undefined = undefined;
  for (const mutationResult of mutationResults) {
    inverseMutation = merge(inverseMutation, mutationResult);
  }
  return inverseMutation;
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
