import { z } from 'zod';
import {
  _source,
  _target,
  IncomingRelationship,
  ModelAny,
  ModelShape,
  OutgoingRelationship,
  SourceBuilder,
  TargetBuilder,
} from '../core/model';
import { InferView, Query } from '../core/view';
import { TypedArray } from '../core/util';

type ObjectWithAs<M extends ModelAny> = {
  as: <
    Q extends Query<
      M,
      TypedArray<OutgoingRelationship<M>>,
      TypedArray<IncomingRelationship<M>>
    >,
  >(
    view: Q,
  ) => InferView<Q>;
};

type ResolvedReferenceSingle<M extends ModelAny> = z.infer<M['schema']> &
  ObjectWithAs<M> extends infer O
  ? { [K in keyof O]: O[K] }
  : never;

type ResolvedReferenceCollection<M extends ModelAny> =
  ResolvedReferenceSingle<M>[] & ObjectWithAs<M>;

type ResolvedReferenceCollectionReadonly<M extends ModelAny> =
  readonly ResolvedReferenceSingle<M>[] & ObjectWithAs<M>;

export function source<
  M extends ModelAny,
  F extends keyof ModelShape<M> & string,
>(
  model: M,
  field: F,
): SourceBuilder<
  M,
  F,
  ResolvedReferenceSingle<M>,
  ResolvedReferenceCollection<M>
> {
  return _source(model, field);
}

export function target<M extends ModelAny>(
  model: M,
): TargetBuilder<
  M,
  ResolvedReferenceSingle<M>,
  ResolvedReferenceCollectionReadonly<M>
> {
  return _target(model);
}
