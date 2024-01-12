import { DiscriminatedEntityWithId } from '../core/model';
import { observable, ObservableObject } from '@legendapp/state';
import {
  InferPoolEntity,
  InferPoolEntityName,
  InferPoolEntityWithId,
  PoolSchema,
  PoolSchemaAny,
} from '../core/pool';

interface PoolState<S extends DiscriminatedEntityWithId> {
  get(
    name: S['name'],
    id: string,
  ): InferObservableDiscriminatedEntity<S> | undefined;
  set(discriminatedEntity: S): void;
  delete(name: S['name'], id: string): void;
  snapshot(): S[];
}

export type InferObservableDiscriminatedEntity<
  RM extends DiscriminatedEntityWithId,
> = RM extends any
  ? {
      readonly name: RM['name'];
      entity: ObservableObject<RM['entity']>;
    }
  : never;

class ObservablePoolState<S extends PoolSchemaAny>
  implements PoolState<InferPoolEntityWithId<S>>
{
  //Observable type shits itself if i put the generic in there
  private entities: Map<
    InferPoolEntityName<S>,
    ObservableObject<{
      [key: string]: DiscriminatedEntityWithId['entity'];
    }>
  > = new Map();

  constructor(schema: S) {
    this.entities = new Map(
      schema.models.map((model) => [
        model.name,
        observable(
          {} as {
            [key: string]: DiscriminatedEntityWithId['entity'];
          },
        ),
      ]),
    );
  }

  delete(name: InferPoolEntityName<S>, id: string): void {
    const entityTable = this.entities.get(name);
    entityTable?.['test']?.delete();
  }

  get(
    name: InferPoolEntityName<S>,
    id: string,
  ): InferObservableDiscriminatedEntity<InferPoolEntityWithId<S>> | undefined {
    const entityTable = this.entities.get(name);
    const entity = entityTable?.[id];
    return entity
      ? ({
          name: name,
          entity: entity,
        } as InferObservableDiscriminatedEntity<InferPoolEntityWithId<S>>)
      : undefined;
  }

  set(discriminatedEntity: InferPoolEntityWithId<S>): void {
    const entityTable = this.entities.get(discriminatedEntity.name);
    if (!entityTable) return;
    entityTable[discriminatedEntity.entity.id]!.set(discriminatedEntity.entity);
  }

  snapshot(): InferPoolEntityWithId<S>[] {
    const snapshotEntity: InferPoolEntityWithId<S>[] = [];
    this.entities.forEach((table, entityName) => {
      Object.entries(table.peek()).forEach(([entityId, entity]) => {
        snapshotEntity.push({
          name: entityName,
          entity: entity,
        } as InferPoolEntityWithId<S>);
      });
    });
    return snapshotEntity;
  }
}
