import { IDBPObjectStore } from 'idb';

export type ObjectWithId = {
  id: string;
  [key: string]: any;
};
export type Set<T extends ObjectWithId> = {
  type: 'Set';
  id: string;
  value: T;
};

export type Delete = {
  type: 'Delete';
  id: string;
};
export type EditCommand<T extends ObjectWithId> = Set<T> | Delete;

export function editStore<
  T extends ObjectWithId,
  S extends IDBPObjectStore<unknown, [string], string, 'readwrite'>,
>(edits: EditCommand<T>[], store: S) {
  for (const edit of edits) {
    switch (edit.type) {
      case 'Set': {
        store.put(edit.value);
        break;
      }
      case 'Delete': {
        store.delete(edit.id);
        break;
      }
    }
  }
}

export function editCache<T extends ObjectWithId>(
  edits: EditCommand<T>[],
  cache: Map<string, T>,
) {
  for (const edit of edits) {
    switch (edit.type) {
      case 'Set': {
        return cache.set(edit.value.id, edit.value);
      }
      case 'Delete': {
        return cache.delete(edit.id);
      }
    }
  }
}
