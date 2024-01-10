import z from 'zod';
import { mergePatch } from './mergePatch';

export const identifier = z.string;
export const reference = z.string;

type Model<T extends string, E extends z.ZodRawShape> = {
  name: T;
  schema: z.ZodObject<E>;
};
type ModelAny = Model<string, z.ZodRawShape>;
type ModelShape<M extends ModelAny> = M['schema']['shape'];

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

type Cardinality = 'one' | 'many';
type WithCardinality<C extends Cardinality, E extends any> = { type: C } & E;

//this typing is fucked
export function one<
  Ref extends SourceRef<ModelAny, string, string | undefined>,
>(
  sourceOrTarget: Ref,
): {
  type: 'one';
  model: Ref['model'];
  field: Ref['field'];
  materializedAs: Ref['materializedAs'];
};
export function one<Ref extends TargetRef<ModelAny, string | undefined>>(
  sourceOrTarget: Ref,
): { type: 'one'; model: Ref['model']; field: Ref['field'] };
export function one<
  Ref extends
    | TargetRef<ModelAny, string | undefined>
    | SourceRef<ModelAny, string, string | undefined>,
>(
  sourceOrTarget: Ref,
): { type: 'one'; model: Ref['model']; field: Ref['field']; renamed?: string } {
  return {
    type: 'one',
    ...sourceOrTarget,
  };
}

//should probably fix this with overloads
//why is this typing so verbose
// export function one<
//   M extends ModelAny,
//   F extends string | undefined,
//   R extends string | undefined,
// >(
//   sourceOrTarget:
//     | { model: M; field: F; renamed: R }
//     | {
//         model: M;
//         field: F;
//       },
// ): { type: 'one'; model: M; field: F; renamed: R } {
//   return {
//     type: 'one',
//     model: sourceOrTarget.model,
//     field: sourceOrTarget.field,
//     renamed: (sourceOrTarget as any)?.renamed ?? undefined, //gross
//   };
// }

// export function many<
//   Ref extends SourceRef<ModelAny, string>
// >(sourceOrTarget: Ref): { type: 'many', model: Ref['model'], field: Ref['field']};
// //why is this typing so verbose
// export function many<
//   Ref extends TargetRef<ModelAny, string>,
// >(sourceOrTarget: Ref): { type: 'many',  model: Ref['model'], field: Ref['field'] }  {
//   return {
//     type: 'many',
//     ...sourceOrTarget
//   };
// }

export function many<
  Ref extends SourceRef<ModelAny, string, string | undefined>,
>(
  sourceOrTarget: Ref,
): {
  type: 'many';
  model: Ref['model'];
  field: Ref['field'];
  materializedAs: Ref['materializedAs'];
};
export function many<Ref extends TargetRef<ModelAny, string | undefined>>(
  sourceOrTarget: Ref,
): { type: 'many'; model: Ref['model']; field: Ref['field'] };
export function many<
  Ref extends
    | TargetRef<ModelAny, string | undefined>
    | SourceRef<ModelAny, string, string | undefined>,
>(
  sourceOrTarget: Ref,
): {
  type: 'many';
  model: Ref['model'];
  field: Ref['field'];
  renamed?: string;
} {
  return {
    type: 'many',
    ...sourceOrTarget,
  };
}

// type SourceRef<M extends ModelAny, F extends keyof ModelShape<M>> = {
//   model: M;
//   field: F;
// };

type SourceRef<
  M extends ModelAny,
  F extends string,
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
  auto: () => F extends `${infer R}Id`
    ? SourceRef<M, F, R>
    : F extends `${infer R}Ids`
      ? SourceRef<M, F, `${R}s`>
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
    auto: () => {
      const inferredMaterializedAs = field.endsWith('Id')
        ? field.substring(0, field.length - 2)
        : 'default';

      return { model, field, materializedAs: inferredMaterializedAs } as any; //yay type hacks
    },
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

type OutgoingRelationship<SM extends ModelAny> = Relationship<
  Cardinality,
  SM,
  string,
  string | undefined,
  Cardinality,
  ModelAny,
  string | undefined
>;
type IncomingRelationship<TM extends ModelAny> = Relationship<
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
  SF extends keyof ModelShape<SM> & string,
  SR extends string | undefined,
  TM extends ModelAny,
  TF extends string | undefined,
>(
  source: SourceRef<SM, SF, SR>,
  target: TargetRef<TM, TF>,
): Relationship<'one', SM, SF, SR, 'one', TM, TF> {
  return relationship(one(source), one(target));
}

export function oneToMany<
  SM extends ModelAny,
  SF extends keyof ModelShape<SM> & string,
  SR extends string | undefined,
  TM extends ModelAny,
  TF extends string | undefined,
>(
  source: SourceRef<SM, SF, SR>,
  target: TargetRef<TM, TF>,
): Relationship<'one', SM, SF, SR, 'many', TM, TF> {
  return relationship(one(source), many(target));
}

export function manyToOne<
  SM extends ModelAny,
  SF extends keyof ModelShape<SM> & string,
  SR extends string | undefined,
  TM extends ModelAny,
  TF extends string | undefined,
>(
  source: SourceRef<SM, SF, SR>,
  target: TargetRef<TM, TF>,
): Relationship<'many', SM, SF, SR, 'one', TM, TF> {
  return relationship(many(source), one(target));
}

export function manyToMany<
  SM extends ModelAny,
  SF extends keyof ModelShape<SM> & string,
  SR extends string | undefined,
  TM extends ModelAny,
  TF extends string | undefined,
>(
  source: SourceRef<SM, SF, SR>,
  target: TargetRef<TM, TF>,
): Relationship<'many', SM, SF, SR, 'many', TM, TF> {
  return relationship(many(source), many(target));
}

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
> = R['type'] extends 'many'
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
      name: RM['name'];
      entity: z.infer<RM['schema']>;
    }
  : never;

export type InferDiscriminatedEntityWithId<RM extends ModelAny> = RM extends any
  ? {
      name: RM['name'];
      entity: z.infer<RM['schema']> & { id: string };
    }
  : never;

type InferMutation<RM extends ModelAny> = RM extends any
  ?
      | {
          operation: 'Create';
          name: RM['name'];
          entity: z.infer<RM['schema']>;
        }
      | {
          operation: 'Update';
          name: RM['name'];
          //this is expected to be a rfc7396 merge patch: https://datatracker.ietf.org/doc/html/rfc7396
          //which is hopefully simpler but more limited
          //may support the other patch format in the future
          //I tried typing this as a deep partial of the model schema but its not really worth it
          //better to just treat it as any and let the merge logic deal with it
          entity: any;
        }
      | {
          operation: 'Delete';
          name: RM['name'];
          entity: { id: string };
        }
  : never;

export type InferEntity<RM extends ModelAny> = z.infer<RM['schema']>;

export type PoolFactory<S extends PoolSchemaAny> = {
  create: <RE extends InferEntity<S['rootModel']>>(
    root: RE,
    entities: InferPoolEntity<S>[],
  ) => Pool<S, RE>;
  empty: () => Pool<S, undefined>;
};

// type InferOrUndefined<M extends ModelAny | undefined> = M

// type EntityMutation<RM extends ModelAny> =
//   | {
//       type: 'Create';
//       name: RM['name'];
//       entity: z.infer<RM['schema']>;
//     }
//   | {
//       type: 'Update';
//       name: RM['name'];
//       entity: z.infer<RM['schema']>;
//     };
export type Pool<
  S extends PoolSchemaAny,
  RE extends InferPoolEntity<S>['entity'] | undefined,
> = {
  root: RE;
  parse: DiscriminatedEntityParser<InferPoolEntity<S>>;
  //a transaction consists of a collection of mutations
  //todo make this a pure function
  apply: (transaction: InferPoolMutation<S>[]) => void;
  //probably should be an array
  //probably wouldn't expose this at all
  entities: Map<InferPoolEntityName<S>, InferPoolEntityWithId<S>>;
};

type DiscriminatedEntityParser<M extends any> = (
  entity: unknown,
) => z.SafeParseReturnType<unknown, M>;

function discriminatedModelParser<S extends PoolSchemaAny>({
  rootModel,
  models,
}: S): DiscriminatedEntityParser<InferPoolEntity<S>> {
  //if the name descriminator was provided as a zod literal in the model, then it would be easier to construct the discriminated entity validator
  // but thought i would save a little verbosity in the API
  const rootDiscriminatedModel = z.object({
    name: z.literal(rootModel.name),
    entity: rootModel.schema,
  });

  const discriminatedModels = models.map((model) =>
    z.object({
      name: z.literal(model.name),
      entity: model.schema,
    }),
  );

  const discriminatedEntityValidator = z.discriminatedUnion('name', [
    rootDiscriminatedModel,
    ...discriminatedModels,
  ]);

  //also means we need to recover the output type manually with this
  return discriminatedEntityValidator.safeParse as DiscriminatedEntityParser<
    InferPoolEntity<S>
  >;
}

// export function thing<
//   RM extends ModelAny,
//   M extends ModelAny,
//
// >(
//   rootModel: RM,
//   models: ModelAny[],
//   options?: {
//     parse?: (
//       entity: unknown,
//     ) => z.SafeParseReturnType<unknown, InferDiscriminatedEntity<M>>
//     onMutation?: (entity: InferDiscriminatedEntity<M>, mutation: InferMutation<M>) => void;
//     onTransaction?: (applyMutations: (() => void)[]) => void;
//   },
// ) {
//
// }

export type PoolSchema<RM extends ModelAny, MA extends ModelAny> = {
  rootModel: RM;
  models: MA[];

  //virtual fields to store types so that we don't have to keep recaculating them
  readonly _model: MA;
  readonly _entity: InferDiscriminatedEntity<MA>;
  readonly _mutation: InferMutation<MA>;
  readonly _entityName: MA['name'];
  readonly _entityWithId: InferDiscriminatedEntityWithId<MA>; //gross
};
type PoolSchemaAny = PoolSchema<ModelAny, ModelAny>;
export type InferPoolModel<S extends PoolSchemaAny> = S['_model'];
export type InferPoolEntity<S extends PoolSchemaAny> = S['_entity'];
export type InferPoolEntityWithId<S extends PoolSchemaAny> = S['_entityWithId'];
export type InferPoolMutation<S extends PoolSchemaAny> = S['_mutation'];
export type InferPoolEntityName<S extends PoolSchemaAny> = S['_entityName'];

// function modelMap<S extends PoolSchema<ModelAny, ModelAny>>(schema: S) {
//   const map = new Map<string, S['models'][number]>();
//   return {};
// }
//
// interface PoolMap<RM extends ModelAny, MA extends ModelAny> {
//   rootModel: RM;
//   models: MA[];
// }

export function poolSchema<
  RM extends ModelAny,
  MA extends TypedArray<ModelAny>,
>(rootModel: RM, models: MA): PoolSchema<RM, RM | MA[number]> {
  //const parse = discriminatedModelParser(rootModel, models)
  return {
    rootModel,
    models,
    _entity: null as any,
    _entityName: null as any,
    _mutation: null as any,
    _model: null as any,
    _entityWithId: null as any,
  };
}

function hasId(
  object: Record<string, any>,
): object is { id: string; [p: string]: any } {
  return 'id' in object;
}

//i would like to be more immutable / pure
//the pool can't be but maybe can get something in between
//this function annoys me
//i keep having to use lots of second order types in the body
//should i make this a class
export function entityPool<S extends PoolSchemaAny>(
  schema: S,
  options?: {
    parse?: DiscriminatedEntityParser<InferPoolEntity<S>>;
    onMutation?: (
      state: {
        entities: Map<InferPoolEntityName<S>, InferPoolEntityWithId<S>>;
      },
      mutation: InferPoolMutation<S>,
      //this will be an entity matching the mutation or undefined if none could be found
      entity: InferPoolEntityWithId<S>['entity'] | undefined,
    ) => void;
    onTransaction?: (applyMutations: (() => void)[]) => void;
    merge?: (entity: InferPoolEntity<S>['entity'], patch: any) => void; //this expects a mutable merge...
  },
): PoolFactory<S> {
  const optionsOrDefault = {
    parse: discriminatedModelParser(schema),
    merge: mergePatch,
    ...options,
  };
  //the typing in here gets pretty rough
  //maybe i should type things as unknown in here

  //probably most efficient would be an array indexed by a map
  //and handle deletions by filling the gap with the tail
  //because the order of elements in the pool shouldn't matter
  //(or get fancier and keep track of holes to skip over and fill in)
  //AKA classic entity pool data structure in game engines
  const state = {
    entities: new Map<InferPoolEntityName<S>, InferPoolEntityWithId<S>>(),
  };

  function getEntity(
    name: InferPoolEntityName<S>,
    id: string,
  ): InferPoolEntityWithId<S>['entity'] | undefined {
    const discriminatedEntity = state.entities.get(id);
    return discriminatedEntity && discriminatedEntity.name === name
      ? discriminatedEntity['entity']
      : undefined;
  }

  function getApplyMutation(
    mutation: InferPoolMutation<S>,
    entity: InferPoolEntityWithId<S>['entity'] | undefined,
  ): (() => void) | undefined {
    switch (mutation.operation) {
      case 'Create': {
        if (entity) {
          console.log('got create for entity which already exists, ignoring');
          break;
        }

        if (hasId(mutation.entity)) {
          const discriminatedEntity: InferPoolEntityWithId<S> = {
            name: mutation.name,
            entity: mutation.entity,
          };

          return () => {
            optionsOrDefault?.onMutation?.(state, mutation, entity);
            state.entities.set(mutation.entity.id, discriminatedEntity);
          };
        }
        return;
      }
      case 'Update': {
        if (!entity) {
          console.log('got update for entity which does not exist, ignoring');
          break;
        }
        if (hasId(mutation.entity)) {
          return () => {
            optionsOrDefault?.onMutation?.(state, mutation, entity);
            optionsOrDefault.merge(entity, mutation.entity);
          };
        }
        break;
      }
      case 'Delete': {
        if (!entity) {
          console.log('got update for entity which does not exist, ignoring');
          break;
        }
        if (hasId(mutation.entity)) {
          return () => {
            options?.onMutation?.(state, mutation, entity);
            state.entities.delete(mutation.entity.id);
          };
        }
        break;
      }
    }
    return undefined;
  }

  function apply(transaction: InferPoolMutation<S>[]) {
    const applyMutations: (() => void)[] = [];
    console.log(transaction);
    for (const mutation of transaction) {
      console.log(mutation);
      const entity = hasId(mutation.entity)
        ? getEntity(mutation.name, mutation.entity.id)
        : undefined;
      const applyMutation = getApplyMutation(mutation, entity);
      if (applyMutation !== undefined) applyMutations.push(applyMutation);
    }
    if (optionsOrDefault.onTransaction) {
      //caller can choose how to apply the mutations
      optionsOrDefault.onTransaction(applyMutations);
    } else {
      //we'll apply the mutations instead
      for (const applyMutation of applyMutations) {
        applyMutation();
      }
    }
  }

  //todo: create transaction queue thingy
  //we assume transactions have already been parsed and deduped etc at this point
  const emptyPool: Pool<S, undefined> = {
    root: undefined,
    parse: optionsOrDefault.parse,
    entities: state.entities,
    apply,
  };

  return {
    create: (root, entities) => {
      console.log(entities);
      emptyPool.apply(
        [{ name: schema.rootModel.name, entity: root }, ...entities].map(
          (entity) => ({
            operation: 'Create',
            name: entity.name,
            entity: entity.entity,
          }),
        ),
      );

      return {
        ...emptyPool,
        root: root,
      };
    },
    empty: () => ({
      ...emptyPool,
      root: undefined,
    }),
  };
}
