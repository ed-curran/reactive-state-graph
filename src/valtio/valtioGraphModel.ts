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
import { InferView, Query, ResolvedBaseEntity } from '../core/view';
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

type ResolvedReferenceSingle<M extends ModelAny> = ResolvedBaseEntity<M>;

type ResolvedReferenceCollection<M extends ModelAny> =
  ResolvedReferenceSingle<M>[];

type ResolvedReferenceCollectionReadonly<M extends ModelAny> =
  readonly ResolvedReferenceSingle<M>[];

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
  ResolvedReferenceCollectionReadonly<M>
> {
  return _source(model, field);
}

export function target<M extends ModelAny>(
  model: M,
): TargetBuilder<
  M,
  ResolvedReferenceSingle<M>,
  ResolvedReferenceCollection<M>
> {
  return _target(model);
}
