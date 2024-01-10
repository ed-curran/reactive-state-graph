import z, { any } from 'zod';
import { mergePatch } from '../mergePatch';

export const identifier = z.string;
export const reference = z.string;

type Model<T extends string, E extends z.ZodRawShape> = {
  name: T;
  schema: z.ZodObject<E>;
};
export type ModelAny = Model<string, z.ZodRawShape>;
type ModelShape<M extends ModelAny> = M['schema']['shape'];
export type InferEntity<M extends ModelAny> = z.infer<M['schema']>;

export function model<T extends string, E extends z.ZodRawShape>(args: {
  name: T;
  shape: E;
}): Model<T, E> {
  return { name: args.name, schema: z.object(args.shape) };
}

type RefBase<M extends ModelAny, F extends string | undefined> = {
  model: M;
  field: F;
};

//when using one and many designations you have to look at both the source and target to figure out
//what type the source field should be. this is awkward for us because we start by modelling the source.
//better for us is the inverse: single and collection
//for single - the source field has to be singular id
//for collection - for collection it has to be a collection of ids
//oneToOne = Single To Single
//oneToMany = Collection to Single
//manyToOne = Single to Collection

type Cardinality = 'single' | 'collection';
type WithCardinality<C extends Cardinality, E extends any> = {
  type: C;
} & E;

export type RefKeysByCardinality<
  S extends z.ZodRawShape,
  C extends Cardinality,
> = C extends 'single' ? SingleRefKey<S> : CollectionRefKeys<S>;

export type RefKey<S extends z.ZodRawShape> = (
  | SingleRefKey<S>
  | CollectionRefKeys<S>
) &
  string;

export type SingleRefKey<S extends z.ZodRawShape> = keyof {
  [K in keyof S as S[K] extends z.ZodString ? K : never]: S[K];
};

export type CollectionRefKeys<S extends z.ZodRawShape> = keyof {
  [K in keyof S as S[K] extends z.ZodArray<z.ZodString> ? K : never]: S[K];
};

export type InferCardinality<
  S extends z.ZodRawShape,
  K extends RefKey<S>,
> = S[K] extends z.ZodArray<z.ZodString> ? 'collection' : 'single';

export function single<
  SM extends ModelAny,
  SF extends string,
  SR extends string | undefined,
>(
  source: SourceRef<SM, SF, SR>,
): {
  type: 'single';
  model: SM;
  field: SF;
  materializedAs: SR;
};
export function single<M extends ModelAny, F extends string | undefined>(
  sourceOrTarget: TargetRef<M, F>,
): { type: 'single'; model: M; field: F };
export function single<
  Ref extends
    | TargetRef<ModelAny, string | undefined>
    | SourceRef<ModelAny, string, string | undefined>,
>(
  sourceOrTarget: Ref,
): {
  type: 'single';
  model: Ref['model'];
  field: Ref['field'];
  materializedAs?: string;
} {
  return {
    type: 'single',
    ...sourceOrTarget,
  };
}

export function collection<
  Ref extends SourceRef<
    ModelAny,
    keyof ModelShape<ModelAny> & string,
    string | undefined
  >,
>(
  sourceOrTarget: Ref,
): {
  type: 'collection';
  model: Ref['model'];
  field: Ref['field'];
  materializedAs: Ref['materializedAs'];
};
export function collection<Ref extends TargetRef<ModelAny, string | undefined>>(
  sourceOrTarget: Ref,
): { type: 'collection'; model: Ref['model']; field: Ref['field'] };
export function collection<
  Ref extends
    | TargetRef<ModelAny, string | undefined>
    | SourceRef<ModelAny, string, string | undefined>,
>(
  sourceOrTarget: Ref,
): {
  type: 'collection';
  model: Ref['model'];
  field: Ref['field'];
  renamed?: string;
} {
  return {
    type: 'collection',
    ...sourceOrTarget,
  };
}

// type Cardinality = 'one' | 'many';
// type WithCardinality<C extends Cardinality, E extends any> = { type: C } & E;

//this typing is fucked
// export function one<
//   Ref extends SourceRef<ModelAny, string, string | undefined>,
// >(
//   sourceOrTarget: Ref,
// ): {
//   type: 'one';
//   model: Ref['model'];
//   field: Ref['field'];
//   materializedAs: Ref['materializedAs'];
// };
// export function one<Ref extends TargetRef<ModelAny, string | undefined>>(
//   sourceOrTarget: Ref,
// ): { type: 'one'; model: Ref['model']; field: Ref['field'] };
// export function one<
//   Ref extends
//     | TargetRef<ModelAny, string | undefined>
//     | SourceRef<ModelAny, string, string | undefined>,
// >(
//   sourceOrTarget: Ref,
// ): { type: 'one'; model: Ref['model']; field: Ref['field']; renamed?: string } {
//   return {
//     type: 'one',
//     ...sourceOrTarget,
//   };
// }
//
// export function many<
//   Ref extends SourceRef<
//     ModelAny,
//     keyof ModelShape<ModelAny> & string,
//     string | undefined
//   >,
// >(
//   sourceOrTarget: Ref,
// ): {
//   type: 'many';
//   model: Ref['model'];
//   field: Ref['field'];
//   materializedAs: Ref['materializedAs'];
// };
// export function many<Ref extends TargetRef<ModelAny, string | undefined>>(
//   sourceOrTarget: Ref,
// ): { type: 'many'; model: Ref['model']; field: Ref['field'] };
// export function many<
//   Ref extends
//     | TargetRef<ModelAny, string | undefined>
//     | SourceRef<ModelAny, string, string | undefined>,
// >(
//   sourceOrTarget: Ref,
// ): {
//   type: 'many';
//   model: Ref['model'];
//   field: Ref['field'];
//   renamed?: string;
// } {
//   return {
//     type: 'many',
//     ...sourceOrTarget,
//   };
// }

// type SourceRef<M extends ModelAny, F extends keyof ModelShape<M>> = {
//   model: M;
//   field: F;
// };

type SourceRef<
  M extends ModelAny,
  F extends keyof ModelShape<M> & string,
  R extends string | undefined,
> = {
  model: M;
  field: F;
  materializedAs: R;
};

// export function source<
//   M extends ModelAny,
//   F extends keyof ModelShape<M> & string,
// >(model: M, field: F): SourceRef<M, F> {
//   return { model, field };
// }

export function source<
  M extends ModelAny,
  F extends keyof ModelShape<M> & string,
>(
  model: M,
  field: F,
): {
  model: M;
  field: F;
  materializedAs: undefined;
  as: <R extends string>(renamed: R) => SourceRef<M, F, R>;
  auto: F extends `${infer R}Id`
    ? () => SourceRef<M, F, R>
    : F extends `${infer R}Ids`
      ? () => SourceRef<M, F, `${R}s`>
      : never;
} {
  return {
    model,
    field,
    materializedAs: undefined,
    as: (materializedAs) => ({
      model,
      field,
      materializedAs,
    }),
    auto: (() => {
      const inferredMaterializedAs = field.endsWith('Id')
        ? field.substring(0, field.length - 2)
        : 'default';

      return { model, field, materializedAs: inferredMaterializedAs }; //yay type hacks
    }) as any, //dude idk
  };
}

//we could auto infer whether the source should be a single or collection
export function ref<
  M extends ModelAny,
  C extends Cardinality,
  F extends RefKeysByCardinality<ModelShape<M>, C> & string,
>(
  type: C,
  model: M,
  field: F,
): {
  type: C;
  model: M;
  field: F;
  materializedAs: undefined;
  as: <R extends string>(renamed: R) => WithCardinality<C, SourceRef<M, F, R>>;
  auto: F extends `${infer R}Id`
    ? () => WithCardinality<C, SourceRef<M, F, R>>
    : F extends `${infer R}Ids`
      ? () => WithCardinality<C, SourceRef<M, F, `${R}s`>>
      : never;
} {
  return {
    type,
    model,
    field,
    materializedAs: undefined,
    as: (materializedAs) => ({
      type,
      model,
      field,
      materializedAs,
    }),
    auto: (() => {
      const inferredMaterializedAs = field.endsWith('Id')
        ? field.substring(0, field.length - 2)
        : 'default';

      return { model, field, materializedAs: inferredMaterializedAs }; //yay type hacks
    }) as any, //dude idk
  };
}

// export function autoSource<M extends ModelAny, F extends keyof ModelShape<M> & string>(
//   model: M,
//   field: F
// ): F extends`${infer R}Id` ? SourceRef<M, F, R> : never {
//   const inferredRenamed = field.endsWith('Id') ? field.substring(0, -2) : 'default'
//
//   return { model, field, renamed: inferredRenamed} as any; //yay more type hacks
// }

type TargetRef<M extends ModelAny, F extends string | undefined> = {
  model: M;
  field: F;
};

export function target<M extends ModelAny>(
  model: M,
): {
  model: M;
  field: undefined;
  as: <F extends string>(field: F) => TargetRef<M, F>;
} {
  return {
    model,
    field: undefined,
    as: <F extends string>(field: F) => ({
      model,
      field,
    }),
  };
}

//the source entity must hold the identifier
type Relationship<
  SC extends Cardinality,
  SM extends ModelAny,
  SF extends keyof ModelShape<SM> & string,
  SR extends string | undefined,
  TC extends Cardinality,
  TM extends ModelAny,
  TF extends string | undefined,
> = {
  source: WithCardinality<SC, SourceRef<SM, SF, SR>>;
  target: WithCardinality<TC, TargetRef<TM, TF>>;
};

// type Relationship<
//   SC extends Cardinality,
//   SM extends ModelAny,
//   SF extends keyof ModelShape<SM> & string,
//   TC extends Cardinality,
//   TM extends ModelAny,
//   TF extends string | undefined,
// > = {
//   source: WithCardinality<SC, SourceRef<SM, SF>>;
//   target: WithCardinality<TC, TargetRef<TM, TF>>;
// };

export type OutgoingRelationship<SM extends ModelAny> = Relationship<
  Cardinality,
  SM,
  string,
  string | undefined,
  Cardinality,
  ModelAny,
  string | undefined
>;
export type IncomingRelationship<TM extends ModelAny> = Relationship<
  Cardinality,
  ModelAny,
  string,
  string | undefined,
  Cardinality,
  TM,
  string | undefined
>;

//a field for the target can be specified to create a bidirectional relationship
// export function relationship<
//   SC extends Cardinality,
//   SM extends ModelAny,
//   SF extends keyof ModelShape<SM> & string,
//   TC extends Cardinality,
//   TM extends ModelAny,
//   TF extends string | undefined,
// >(
//   source: WithCardinality<SC, SourceRef<SM, SF>>,
//   target: WithCardinality<TC, TargetRef<TM, TF>>,
// ): Relationship<SC, SM, SF, TC, TM, TF> {
//   return {
//     source,
//     target,
//   };
// }

export function relationship<
  SC extends Cardinality,
  SM extends ModelAny,
  SF extends string,
  SR extends string | undefined,
  TC extends Cardinality,
  TM extends ModelAny,
  TF extends string | undefined,
>(
  source: WithCardinality<SC, SourceRef<SM, SF, SR>>,
  target: WithCardinality<TC, TargetRef<TM, TF>>,
): Relationship<SC, SM, SF, SR, TC, TM, TF> {
  return {
    source,
    target,
  };
}

export function oneToOne<
  SM extends ModelAny,
  SF extends SingleRefKey<ModelShape<SM>> & string,
  SR extends string | undefined,
  TM extends ModelAny,
  TF extends string | undefined,
>(
  source: SourceRef<SM, SF, SR>,
  target: TargetRef<TM, TF>,
): Relationship<'single', SM, SF, SR, 'single', TM, TF> {
  return relationship(single(source), single(target));
}

export function oneToMany<
  SM extends ModelAny,
  SF extends CollectionRefKeys<ModelShape<SM>> & string,
  SR extends string | undefined,
  TM extends ModelAny,
  TF extends string | undefined,
>(
  source: SourceRef<SM, SF, SR>,
  target: TargetRef<TM, TF>,
): Relationship<'collection', SM, SF, SR, 'single', TM, TF> {
  return relationship(collection(source), single(target));
}

export function manyToOne<
  SM extends ModelAny,
  SF extends SingleRefKey<ModelShape<SM>> & string,
  SR extends string | undefined,
  TM extends ModelAny,
  TF extends string | undefined,
>(
  source: SourceRef<SM, SF, SR>,
  target: TargetRef<TM, TF>,
): Relationship<'single', SM, SF, SR, 'collection', TM, TF> {
  return relationship(single(source), collection(target));
}

//is this even possible?
// export function manyToMany<
//   SM extends ModelAny,
//   SF extends ModelShape<SM>[SF] extends z.ZodArray<z.ZodString>
//     ? keyof ModelShape<SM> & string
//     : never,
//   SR extends string | undefined,
//   TM extends ModelAny,
//   TF extends string | undefined,
// >(
//   source: SourceRef<SM, SF, SR>,
//   target: TargetRef<TM, TF>,
// ): Relationship<'many', SM, SF, SR, 'many', TM, TF> {
//   return relationship(many(source), many(target));
// }

//from this point on we expect peeople to have constructed a relationship type using relationship function
//because we won't be typechecking it properly due to using RelationshipAny

// type OneToOne<SE extends z.ZodRawShape, TE extends z.ZodRawShape> = ReturnType<typeof oneToOne<SE, SF extends keyof SE, >>

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

type ResolvedReference<
  R extends WithCardinality<Cardinality, RefBase<ModelAny, any>>,
> = z.infer<R['model']['schema']> & {
  as: <
    Q extends Query<
      R['model'],
      TypedArray<OutgoingRelationship<R['model']>>,
      TypedArray<IncomingRelationship<R['model']>>
    >,
  >(
    view: Q,
  ) => ResolvedQuery<Q>;
} extends infer O
  ? { [K in keyof O]: O[K] }
  : never;

type InferReferenceOutput<
  R extends WithCardinality<Cardinality, RefBase<ModelAny, any>>,
> = R['type'] extends 'collection'
  ? ResolvedReference<R>[] & {
      as: <
        Q extends Query<
          R['model'],
          TypedArray<OutgoingRelationship<R['model']>>,
          TypedArray<IncomingRelationship<R['model']>>
        >,
      >(
        view: Q,
      ) => ResolvedQuery<Q>[];
    }
  : ResolvedReference<R>;

type ExcludeUndefined<T> = T extends undefined ? never : T;

//these aren't very typesafe, fine for now cus they're just used by ResolvedQueryShape
type ResolvedIncoming<
  SM extends any,
  R extends IncomingRelationship<ModelAny>,
> = SM & {
  [P in R as ExcludeUndefined<P['target']['field']>]: InferReferenceOutput<
    P['source']
  >;
} extends infer O
  ? { [K in keyof O]: O[K] }
  : never;

type ResolvedOutgoing<
  SM extends any,
  R extends OutgoingRelationship<ModelAny>,
> = Omit<SM, R['source']['field']> & {
  [P in R as ExcludeUndefined<
    P['source']['materializedAs']
  >]: InferReferenceOutput<P['target']>;
} extends infer O
  ? { [K in keyof O]: O[K] }
  : never;

export type TypedArray<M extends any> = [...M[]];
type NonEmptyTypedArray<M extends any> = [M, ...M[]];

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

//this conditional is needed to distribute over the members of the union
//so that we can discriminate over it as expected later
//from: https://stackoverflow.com/questions/51691235/typescript-map-union-type-to-another-union-type
export type InferDiscriminatedEntity<RM extends ModelAny> = RM extends any
  ? {
      readonly name: RM['name'];
      entity: z.infer<RM['schema']>;
    }
  : never;

export type InferDiscriminatedEntityWithId<RM extends ModelAny> = RM extends any
  ? {
      readonly name: RM['name'];
      entity: z.infer<RM['schema']> & { readonly id: string };
    }
  : never;
