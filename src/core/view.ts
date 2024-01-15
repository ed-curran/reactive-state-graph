import { z } from 'zod';
import {
  AnyRef,
  IncomingRelationship,
  InferEntity,
  ModelAny,
  OutgoingRelationship,
} from './model';
import { TypedArray } from './util';

export type QueryShape<
  M extends ModelAny,
  O extends TypedArray<OutgoingRelationship<M>>,
  I extends TypedArray<IncomingRelationship<M>>,
> = {
  model: M;
  //relationships where the model is the source
  outgoingRelations?: O;
  //relationships where the model is the target
  incomingRelations?: I;
};

export type Query<
  M extends ModelAny,
  O extends TypedArray<OutgoingRelationship<M>>,
  I extends TypedArray<IncomingRelationship<M>>,
  Output = any,
> = {
  model: M;
  //relationships where the model is the source
  outgoingRelations?: O;
  //relationships where the model is the target
  incomingRelations?: I;
  readonly _output: Output; //fake value to store the output type of the query
};

export type QueryAny = Query<
  ModelAny,
  TypedArray<OutgoingRelationship<ModelAny>>,
  TypedArray<IncomingRelationship<ModelAny>>
>;

//this was the only sane way to i could find to get the output to be typed
//nicely in the presence of optional relations etc
//thankfully we don't have that many permutations...
type QueryBuilder<M extends ModelAny> = {
  model: M;
  _output: InferEntity<M>;
  incoming: <I extends TypedArray<IncomingRelationship<M>>>(
    incoming: I,
  ) => {
    model: M;
    incomingRelations: I;
    _output: ResolvedIncoming<InferEntity<M>, I[number]>;
    outgoing: <O extends TypedArray<OutgoingRelationship<M>>>(
      outgoing: O,
    ) => {
      model: M;
      incomingRelations: I;
      outgoingRelations: O;
      _output: ResolvedQueryShape<M, O, I>;
    };
  };
  outgoing: <O extends TypedArray<OutgoingRelationship<M>>>(
    outgoing: O,
  ) => {
    model: M;
    outgoingRelations: O;
    _output: ResolvedOutgoing<InferEntity<M>, O[number]>;
    incoming: <I extends TypedArray<IncomingRelationship<M>>>(
      incoming: I,
    ) => {
      model: M;
      outgoingRelations: O;
      incomingRelations: I;
      _output: ResolvedQueryShape<M, O, I>;
    };
  };
};

type DefaultRef = {};

export function view<M extends ModelAny>(model: M): QueryBuilder<M> {
  //hacks for vitual _output field
  return {
    model,
    _output: null as any,
    incoming: (incoming) => ({
      model,
      incomingRelations: incoming,
      _output: null as any, //hax
      outgoing: (outgoing) => ({
        model,
        outgoingRelations: outgoing,
        incomingRelations: incoming,
        _output: null as any, //hax
      }),
    }),
    outgoing: (outgoing) => ({
      model,
      outgoingRelations: outgoing,
      _output: null as any, //hax,
      incoming: (incoming) => ({
        model,
        outgoingRelations: outgoing,
        incomingRelations: incoming,
        _output: null as any, //hax,
      }),
    }),
  };
}

//we mark target references as readonly because we only allow modifications on the source side for now
type InferReferenceOutput<
  R extends AnyRef,
  S,
  C,
> = R['type'] extends 'collection' ? S : C;

type ExcludeUndefined<T> = T extends undefined ? never : T;

//these aren't very typesafe, fine for now cus they're just used by ResolvedQueryShape
type ResolvedIncoming<
  SM extends any,
  R extends IncomingRelationship<ModelAny>,
> = SM & {
  readonly [P in R as ExcludeUndefined<
    P['target']['field']
  >]: InferReferenceOutput<
    P['source'],
    P['_outputSourceSingle'],
    P['_outputSourceCollection']
  >;
} extends infer O
  ? { [K in keyof O]: O[K] }
  : never;

type ResolvedOutgoing<
  SM extends any,
  R extends OutgoingRelationship<ModelAny>,
> = SM & {
  [P in R as ExcludeUndefined<
    P['source']['materializedAs']
  >]: InferReferenceOutput<
    P['target'],
    P['_outputTargetSingle'],
    P['_outputTargetCollection']
  >;
} extends infer O
  ? { [K in keyof O]: O[K] }
  : never;

type ResolvedQueryShape<
  M extends ModelAny,
  O extends TypedArray<OutgoingRelationship<M>>,
  I extends TypedArray<IncomingRelationship<M>>,
> = ResolvedIncoming<
  ResolvedOutgoing<z.infer<M['schema']>, O[number]>,
  I[number]
>;

type ResolvedQuery<Q extends QueryAny> = Q['_output'];
export type InferView<Q extends QueryAny> = ResolvedQuery<Q>;

export function resolve<Q extends QueryAny>(
  view: Q,
  entity: z.infer<Q['model']['schema']>,
): ResolvedQuery<Q> {
  return undefined;
}
