import {
  InferEntity,
  InferView,
  ModelAny,
  OutgoingRelationship,
  QueryAny,
  TypedArray,
} from './model';
import {
  InferPoolEntity,
  InferPoolRootEntity,
  Pool,
  PoolSchema,
  poolSchema,
} from './pool';

type QueryArrayToModelArray<T extends TypedArray<QueryAny>> = {
  [Index in keyof T]: T[Index]['model'];
};

export type InferDiscriminatedView<RM extends QueryAny> = RM extends any
  ? {
      name: RM['model']['name'];
      resolvedEntity: InferView<RM>;
    }
  : never;

export type GraphSchema<RV extends QueryAny, V extends QueryAny> = {
  rootView: RV;
  views: V[];
  poolSchema: PoolSchema<RV['model'], V['model']>;

  _view: V;
  //todo: better name for this
  //view is the structure, but what should an instance be called?
  _resolvedEntity: InferDiscriminatedView<RV | V>;
};

export type InferGraphResolvedEntity<S extends GraphSchemaAny> =
  S['_resolvedEntity'];
export type InferGraphView<S extends GraphSchemaAny> = S['_view'];
export type InferGraphRootView<S extends GraphSchemaAny> = S['rootView'];
export type InferGraphRootResolvedEntity<S extends GraphSchemaAny> = InferView<
  S['rootView']
>;

export type GraphSchemaAny = GraphSchema<QueryAny, QueryAny>;

export function graphSchema<
  RV extends QueryAny,
  MV extends TypedArray<QueryAny>,
>(rootView: RV, views: MV): GraphSchema<RV, RV | MV[number]> {
  return {
    rootView,
    views,
    poolSchema: poolSchema(
      rootView.model,
      views.map((view) => view.model),
    ),
    _view: null as any,
    _resolvedEntity: null as any,
  };
}

export interface Graph<S extends GraphSchemaAny> {
  withRoot(
    root: InferPoolRootEntity<S['poolSchema']>,
    entities?: InferPoolEntity<S['poolSchema']>[],
  ): InferGraphRootResolvedEntity<S>;
  getRoot(): InferGraphRootResolvedEntity<S> | undefined;
  getPool(): Pool<S['poolSchema']>;
}

function targetIds<M extends ModelAny, S extends OutgoingRelationship<M>>(
  sourceEntity: InferEntity<M>,
  outgoingRelation: S,
): ReadonlyArray<string> {
  const targetIds = new Array<string>();
  switch (outgoingRelation.source.type) {
    case 'single': {
      const relationTargetId = sourceEntity[
        outgoingRelation.source.field
      ] as string;
      targetIds.push(relationTargetId);
      return [relationTargetId];
    }
    case 'collection': {
      return sourceEntity[outgoingRelation.source.field] as string[];
    }
  }
}
