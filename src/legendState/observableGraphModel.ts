import {
  ModelAny,
  OutgoingRelationship,
  IncomingRelationship,
  ModelShape,
  SourceBuilder,
  _source,
  TargetBuilder,
  _target,
  InferEntity,
} from '../core/model';
import { InferView, Query } from '../core/view';
import { TypedArray } from '../core/util';
import { ObservableArray, ObservableObject } from '@legendapp/state';

export interface TargetRefWithView<M extends ModelAny> {
  id: string;
  //portals through to another entity in the graph, the returned observable:
  //1. does get notified when the entry entity is modified but only when listening to the observable returned, not on nested fields (no idea why)
  //2. does get notified when this entity is modified by others (i.e. those that have portaled to it)
  //3. does notify others listening to this entity
  //4. does not notify the entry entity when modified
  portal: <
    Q extends
      | Query<
          M,
          TypedArray<OutgoingRelationship<M>>,
          TypedArray<IncomingRelationship<M>>
        >
      | undefined = undefined,
  >(
    view?: Q,
  ) => Q extends object
    ? ObservableObject<InferView<Q>>
    : ObservableObject<InferEntity<M>>;

  //appends a readonly branch containing the referenced entity to the current "tree", the returned observable:
  //1. does get notified when the parent is modified when listening anywhere in the branch
  //2. does not get notified when others modify this entity elsewhere in the graph
  //3. can not be modified
  // branch: ObservableComputed<T>;

  //replace this reference with another, only available on the source of the reference
  // replace(replacement?: T): void;
}

export interface SourceRefWithView<M extends ModelAny> {
  id: string;
  //portals through to another entity in the graph, the returned observable:
  //1. does get notified when the entry entity is modified but only when listening to the observable returned, not on nested fields (no idea why)
  //2. does get notified when this entity is modified by others (i.e. those that have portaled to it)
  //3. does notify others listening to this entity
  //4. does not notify the entry entity when modified
  portal: <
    Q extends
      | Query<
          M,
          TypedArray<OutgoingRelationship<M>>,
          TypedArray<IncomingRelationship<M>>
        >
      | undefined = undefined,
  >(
    view?: Q,
  ) => Q extends object
    ? ObservableObject<InferView<Q>>
    : ObservableObject<InferEntity<M>>;

  //appends a readonly branch containing the referenced entity to the current "tree", the returned observable:
  //1. does get notified when the parent is modified when listening anywhere in the branch
  //2. does not get notified when others modify this entity elsewhere in the graph
  //3. can not be modified
  // branch: ObservableComputed<T>;

  //replace this reference with another, only available on the source of the reference
  replaceWith(replacement?: ObservableObject<InferEntity<M>>): void;
}

//the source gets materialised onto the target, so this uses a targetRef
//which is kind of confusing
export function source<
  M extends ModelAny,
  F extends keyof ModelShape<M> & string,
>(
  model: M,
  field: F,
): SourceBuilder<
  M,
  F,
  ObservableObject<TargetRefWithView<M>>,
  ObservableArray<TargetRefWithView<M>[]>
> {
  return _source(model, field);
}

//the target gets materialised onto the source, so this uses a sourceRef
//which is kind of confusing
export function target<M extends ModelAny>(
  model: M,
): TargetBuilder<
  M,
  ObservableObject<SourceRefWithView<M>>,
  ObservableArray<SourceRefWithView<M>[]>
> {
  return _target(model);
}
