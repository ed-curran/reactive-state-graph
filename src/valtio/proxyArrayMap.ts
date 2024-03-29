import { proxy, ref, subscribe } from 'valtio/vanilla';
import { Op } from './valtioPool';

type KeyValRecord<K, V> = [key: K, value: V];

export type ArrayMap<K, V> = Map<K, V> & {
  index: Map<K, number>;
  data: KeyValRecord<K, V>[];
  toJSON: object;
};

/**
 * proxyMap
 *
 * This is to create a proxy which mimic the native Map behavior.
 * The API is the same as Map API
 *
 * @example
 * import { proxyMap } from 'valtio/utils'
 * const state = proxyMap([["key", "value"]])
 *
 * //can be used inside a proxy as well
 * const state = proxy({
 *   count: 1,
 *   map: proxyMap()
 * })
 *
 * // When using an object as a key, you can wrap it with `ref` so it's not proxied
 * // this is useful if you want to preserve the key equality
 * import { ref } from 'valtio'
 *
 * const key = ref({})
 * state.set(key, "value")
 * state.get(key) //value
 *
 * const key = {}
 * state.set(key, "value")
 * state.get(key) //undefined
 */
export function proxyArrayMap<K, V>(
  items?: Iterable<KeyValRecord<K, V>> | null,
): ArrayMap<K, V> {
  const entries: KeyValRecord<K, V>[] = items ? Array.from(items) : [];
  // const index = new Map<string, V>(entries);
  const map: ArrayMap<K, V> = proxy({
    index: ref(new Map(entries.map(([key], index) => [key, index]))),
    data: entries,
    has(key) {
      return this.index.has(key);
    },
    set(key, value) {
      const itemIndex = this.index.get(key);
      if (itemIndex === undefined) {
        const index = this.data.push([key, value]) - 1;
        this.index.set(key, index);
      } else {
        const record = this.data[itemIndex]!;
        record[1] = value;
      }

      return this;
    },
    get(key) {
      const index = this.index.get(key);
      if (index === undefined) return undefined;
      return this.data[index]![1];
    },
    delete(key) {
      const itemIndex = this.index.get(key);
      if (itemIndex === undefined) {
        return false;
      }
      //replace the deleted item with the last item
      //this is to avoid shifting the array which is O(n)
      //but this will change the order of the items
      const lastItem = this.data.pop();
      if (lastItem) this.data[itemIndex] = lastItem;

      this.index.delete(key);
      return true;
    },
    clear() {
      this.data.splice(0);
      this.index.clear();
    },
    get size() {
      return this.data.length;
    },
    toJSON() {
      //what?
      return new Map(this.data);
    },
    forEach(cb) {
      this.data.forEach((p) => {
        cb(p[1], p[0], this);
      });
    },
    keys() {
      return this.data.map((p) => p[0]).values();
    },
    values() {
      return this.data.map((p) => p[1]).values();
    },
    entries() {
      return Array.from(this.data).values();
    },
    get [Symbol.toStringTag]() {
      return 'Map';
    },
    [Symbol.iterator]() {
      return this.entries();
    },
  });

  Object.defineProperties(map, {
    data: {
      enumerable: false,
    },
    index: {
      enumerable: false,
    },
    size: {
      enumerable: false,
    },
    toJSON: {
      enumerable: false,
    },
  });
  Object.seal(map);

  return map;
}

export function keyFromArrayMapPath<K, V>(
  arrayMap: ArrayMap<K, V>,
  path: Op[1],
): K {
  const itemIndex = path[1]!;
  return arrayMap.data[Number(itemIndex)]![0];
}
export function subscribeArrayMap<V>(
  arrayMap: ArrayMap<string, V>,
  callback: Parameters<typeof subscribe>[1],
  notifyInSync: Parameters<typeof subscribe>[2],
) {
  subscribe(
    arrayMap,
    (ops) => {
      const updatedOps: Op[] = [];
      for (const op in ops) {
      }
      callback(updatedOps);
    },
    notifyInSync,
  );
}
