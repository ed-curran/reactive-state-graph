import {
  InferEntity,
  InferView,
  QueryAny,
  resolve,
  TypedArray,
  PoolFactory,
  entityPool, PoolSchema, InferDiscriminatedEntity, InferDiscriminatedEntityWithId, poolSchema, InferPoolEntity, Pool,
} from './model';
import z from 'zod'

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
  poolSchema: PoolSchema<RV['model'],V['model']>

  _view: V
  //todo: better name for this
  //view is the structure, but what should an instance be called?
  _resolvedEntity: InferDiscriminatedView<RV | V>
};

export type InferGraphResolvedEntity<S extends GraphSchemaAny> = S['_resolvedEntity']
export type InferGraphView<S extends GraphSchemaAny> = S['_view']

export type GraphSchemaAny = GraphSchema<QueryAny, QueryAny>

export function graphSchema<
  RV extends QueryAny,
  MV extends TypedArray<QueryAny>,
>(rootView: RV, views: MV): GraphSchema<RV, RV | MV[number]> {
  return {
    rootView,
    views,
    poolSchema: poolSchema(rootView.model, views.map(view => view.model)),
    _view: null as any,
    _resolvedEntity: null as any
  };
}

export function graph<S extends GraphSchemaAny>(
  schema: S,
  poolFactory?: PoolFactory<S['poolSchema']>,
) {
  const viewMap: Map<InferGraphView<S>['model']['name'], InferGraphView<S>>
  //idk why the typing here is fucked
  const poolFactoryOrDefault: PoolFactory<S['poolSchema']> = poolFactory ?? entityPool(
    schema.poolSchema,
    {
      onMutation(state, mutation, entity) {
        const view = viewMap.get(mutation.name)
        if(!view) return

        switch(mutation.operation) {
          case 'Create': {
            if(view.outgoingRelations) {
              for (const outgoingRelation of view.outgoingRelations) {
                //todo
              }
            }
          }
        }

      }
    },
  )

  return {
    create: (
      root: InferEntity<S['rootView']['model']>,
      entities: InferPoolEntity<S['poolSchema']>[]
    ): {
      root: InferView<S['rootView']>;
      pool: Pool<S['poolSchema'], InferEntity<S['rootView']['model']>>
    } => {
      const pool = poolFactoryOrDefault.create(root, entities);
      return {
        root: resolve(schema.rootView, pool.root),
        pool
      };
    },
    empty: (): {
      root: InferView<S['rootView']> | undefined;
      pool: Pool<S['poolSchema'], InferEntity<S['rootView']['model']> | undefined>
    } => {
      const pool = poolFactoryOrDefault.empty();
      return {
        root: undefined,
        pool
      };
    },
  };
}
