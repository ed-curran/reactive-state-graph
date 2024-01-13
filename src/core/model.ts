import z from 'zod';

export const identifier = z.string;
export const reference = z.string;

type Model<T extends string, E extends z.ZodRawShape> = {
  name: T;
  schema: z.ZodObject<E>;
};
export type ModelAny = Model<string, z.ZodRawShape>;
export type ModelShape<M extends ModelAny> = M['schema']['shape'];
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

export type Cardinality = 'single' | 'collection';
export type WithCardinality<C extends Cardinality, E extends any> = {
  type: C;
} & E;

export type AnyRef = WithCardinality<Cardinality, RefBase<ModelAny, any>>

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

type TargetRefAny = TargetRef<ModelAny, string | undefined, any, any>
type SourceRefAny = SourceRef<ModelAny, string, string | undefined, any, any>

export function single<
  Ref extends SourceRefAny
>(
  source: Ref,
): {
  type: 'single';
  model: Ref['model'];
  field: Ref['field'];
  materializedAs: Ref['materializedAs'];
  _outputSingle: Ref['_outputSingle']
  _outputCollection: Ref['_outputCollection']
};
export function single<Ref extends TargetRefAny>(
  sourceOrTarget: Ref,
): { type: 'single'; model: Ref['model']; field: Ref['field'],  _outputSingle: Ref['_outputSingle']
_outputCollection: Ref['_outputCollection'] };
export function single<
  Ref extends
    | TargetRefAny
    | SourceRefAny,
>(
  sourceOrTarget: Ref,
): {
  type: 'single';
  model: Ref['model'];
  field: Ref['field'];
  materializedAs?: string;
  _outputSingle: Ref['_outputSingle']
  _outputCollection: Ref['_outputCollection']
} {
  return {
    type: 'single',
    ...sourceOrTarget,
  };
}

export function collection<
  Ref extends SourceRefAny,
>(
  sourceOrTarget: Ref,
): {
  type: 'collection';
  model: Ref['model'];
  field: Ref['field'];
  materializedAs: Ref['materializedAs'];
  _outputSingle: Ref['_outputSingle']
  _outputCollection: Ref['_outputCollection']
};
export function collection<Ref extends TargetRefAny>(
  sourceOrTarget: Ref,
): { type: 'collection'; model: Ref['model']; field: Ref['field'],   _outputSingle: Ref['_outputSingle']
_outputCollection: Ref['_outputCollection'] };
export function collection<
  Ref extends
    | TargetRefAny
    | SourceRefAny,
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

export type SourceRef<
  M extends ModelAny,
  F extends keyof ModelShape<M> & string,
  R extends string | undefined,
  OS,
  OC,
> = {
  model: M;
  field: F;
  materializedAs: R;
  _outputSingle: OS
  _outputCollection: OS
};

// export function source<
//   M extends ModelAny,
//   F extends keyof ModelShape<M> & string,
// >(model: M, field: F): SourceRef<M, F> {
//   return { model, field };
// }

export type SourceBuilder< M extends ModelAny,
F extends keyof ModelShape<M> & string,
OS,
OC> = {
  model: M;
  field: F;
  materializedAs: undefined;
  _outputSingle: OS,
  _outputCollection: OC,
  as: <R extends string>(renamed: R) => SourceRef<M, F, R, OS, OC>;
  auto: F extends `${infer R}Id`
    ? () => SourceRef<M, F, R, OS, OC>
    : F extends `${infer R}Ids`
      ? () => SourceRef<M, F, `${R}s`, OS, OC>
      : never;
}

export function _source<
  M extends ModelAny,
  F extends keyof ModelShape<M> & string,
  OS,
  OC
>(
  model: M,
  field: F,
): SourceBuilder<M, F, OS, OC> {
  return {
    model,
    field,
    materializedAs: undefined,
    _outputSingle: null as any,
    _outputCollection: null as any,
    as: (materializedAs) => ({
      model,
      field,
      materializedAs,
      _outputSingle: null as any,
      _outputCollection: null as any
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
// export function ref<
//   M extends ModelAny,
//   C extends Cardinality,
//   F extends RefKeysByCardinality<ModelShape<M>, C> & string,
// >(
//   type: C,
//   model: M,
//   field: F,
// ): {
//   type: C;
//   model: M;
//   field: F;
//   materializedAs: undefined;
//   as: <R extends string>(renamed: R) => WithCardinality<C, SourceRef<M, F, R>>;
//   auto: F extends `${infer R}Id`
//     ? () => WithCardinality<C, SourceRef<M, F, R>>
//     : F extends `${infer R}Ids`
//       ? () => WithCardinality<C, SourceRef<M, F, `${R}s`>>
//       : never;
// } {
//   return {
//     type,
//     model,
//     field,
//     materializedAs: undefined,
//     as: (materializedAs) => ({
//       type,
//       model,
//       field,
//       materializedAs,
//     }),
//     auto: (() => {
//       const inferredMaterializedAs = field.endsWith('Id')
//         ? field.substring(0, field.length - 2)
//         : 'default';

//       return { model, field, materializedAs: inferredMaterializedAs }; //yay type hacks
//     }) as any, //dude idk
//   };
// }

// export function autoSource<M extends ModelAny, F extends keyof ModelShape<M> & string>(
//   model: M,
//   field: F
// ): F extends`${infer R}Id` ? SourceRef<M, F, R> : never {
//   const inferredRenamed = field.endsWith('Id') ? field.substring(0, -2) : 'default'
//
//   return { model, field, renamed: inferredRenamed} as any; //yay more type hacks
// }

export type TargetRef<M extends ModelAny, F extends string | undefined, OS, OC> = {
  model: M;
  field: F;
  _outputSingle: OS
  _outputCollection: OC
};

export type TargetBuilder<M extends ModelAny, OS, OC> = {
  model: M;
  field: undefined;
  _outputSingle: OS,
  _outputCollection: OC,
  as: <F extends string>(field: F) => TargetRef<M, F, OS, OC>;
}
export function _target<M extends ModelAny, OS, OC>(
  model: M,
): TargetBuilder<M, OS, OC> {
  return {
    model,
    field: undefined,
    _outputSingle: null as any,
    _outputCollection: null as any,
    as: <F extends string>(field: F) => ({
      model,
      field,
      _outputSingle: null as any,
      _outputCollection: null as any
    }),
  };
}

//the source entity must hold the identifier
export type Relationship<
  SC extends Cardinality,
  SM extends ModelAny,
  SF extends keyof ModelShape<SM> & string,
  SR extends string | undefined,
  TC extends Cardinality,
  TM extends ModelAny,
  TF extends string | undefined,
  OSS,
  OSC,
  OTS,
  OTC
> = {
  source: WithCardinality<SC, SourceRef<SM, SF, SR, OSS, OSC>>;
  target: WithCardinality<TC, TargetRef<TM, TF, OTS, OTC>>;
  //please ignore
  readonly _outputSourceSingle: OSS
  readonly _outputSourceCollection: OSC
  readonly _outputTargetSingle: OTS
  readonly _outputTargetCollection: OTC
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
  string | undefined,
  any,
  any,  
  any,
  any
>;
export type IncomingRelationship<TM extends ModelAny> = Relationship<
  Cardinality,
  ModelAny,
  string,
  string | undefined,
  Cardinality,
  TM,
  string | undefined,
  any,
  any,
  any,
  any
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
  OSS,
  OSC,
  OTS,
  OTC
>(
  source: WithCardinality<SC, SourceRef<SM, SF, SR, OSS, OSC>>,
  target: WithCardinality<TC, TargetRef<TM, TF, OTS, OTC>>,
): Relationship<SC, SM, SF, SR, TC, TM, TF, OSS, OSC, OTS, OTC> {
  return {
    source,
    target,
    _outputSourceSingle: null as any,
    _outputSourceCollection: null as any,
    _outputTargetSingle: null as any,
    _outputTargetCollection: null as any,
  };
}



export function oneToOne<
  SM extends ModelAny,
  SF extends SingleRefKey<ModelShape<SM>> & string,
  SR extends string | undefined,
  TM extends ModelAny,
  TF extends string | undefined,
  OSS,
  OSC,
  OTS,
  OTC
>(
  source: SourceRef<SM, SF, SR, OSS, OSC>,
  target: TargetRef<TM, TF, OTS, OTC>,
): Relationship<'single', SM, SF, SR, 'single', TM, TF, OSS, OSC, OTS, OTC> {
  return relationship(single(source), single(target));
}

export function oneToMany<
  SM extends ModelAny,
  SF extends CollectionRefKeys<ModelShape<SM>> & string,
  SR extends string | undefined,
  TM extends ModelAny,
  TF extends string | undefined,
  OSS,
  OSC,
  OTS,
  OTC
>(
  source: SourceRef<SM, SF, SR, OSS, OSC>,
  target: TargetRef<TM, TF, OTS, OTC>,
): Relationship<'collection', SM, SF, SR, 'single', TM, TF, OSS, OSC, OTS, OTC> {
  return relationship(collection(source), single(target));
}

export function manyToOne<
  SM extends ModelAny,
  SF extends SingleRefKey<ModelShape<SM>> & string,
  SR extends string | undefined,
  TM extends ModelAny,
  TF extends string | undefined,
  OSS,
  OSC,
  OTS,
  OTC
>(
  source: SourceRef<SM, SF, SR, OSS, OSC>,
  target: TargetRef<TM, TF, OTS, OTC>,
): Relationship<'single', SM, SF, SR, 'collection', TM, TF,  OSS, OSC, OTS, OTC> {
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

export type DiscriminatedEntityWithId = {
  readonly name: string;
  entity: {
    id: string;
    [key: string]: any;
  };
};

type Test = Record<string, string>;
