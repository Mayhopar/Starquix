import * as Y from 'yjs';

export type YjsScope = Readonly<{ map: string; keys?: readonly string[] }>;
type Subscriber = { notify: () => void; active: boolean };
type MapObserver = {
  map: Y.Map<unknown>;
  consumers: Map<Subscriber, ReadonlySet<string> | undefined>;
  observe: (events: Y.YEvent<Y.AbstractType<unknown>>[], transaction: Y.Transaction) => void;
};
type Registry = {
  maps: Map<string, MapObserver>;
  pending: Map<Y.Transaction, Set<Subscriber>>;
  flush: (transaction: Y.Transaction) => void;
};
const registries = new WeakMap<Y.Doc, Registry>();

/** Merge duplicate memberships; an omitted key set covers the entire map. */
export function normalizeYjsScopes(scopes: readonly YjsScope[]): YjsScope[] {
  const maps = new Map<string, Set<string> | undefined>();
  for (const { map, keys } of scopes) {
    if (keys?.length === 0 || (maps.has(map) && maps.get(map) === undefined)) continue;
    if (keys === undefined) maps.set(map, undefined);
    else {
      const membership = maps.get(map) ?? new Set<string>();
      keys.forEach(key => membership.add(key));
      maps.set(map, membership);
    }
  }
  return [...maps].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([map, keys]) => keys === undefined ? { map } : { map, keys: [...keys].sort() });
}

/** Read-only map observers, shared by all scoped consumers of a document. */
export function subscribeYjsScopes(doc: Y.Doc, scopes: readonly YjsScope[], notify: () => void): () => void {
  const normalized = normalizeYjsScopes(scopes);
  if (!normalized.length) return () => {};
  let registry = registries.get(doc);
  if (!registry) {
    const pending = new Map<Y.Transaction, Set<Subscriber>>();
    registry = {
      maps: new Map(), pending,
      flush: transaction => {
        const subscribers = pending.get(transaction);
        pending.delete(transaction);
        // Delete before calling consumers: notifications can start another transaction.
        subscribers?.forEach(subscriber => { if (subscriber.active) subscriber.notify(); });
      },
    };
    registries.set(doc, registry);
    doc.on('afterTransaction', registry.flush);
  }
  const subscriber: Subscriber = { notify, active: true };
  const subscribedMaps: MapObserver[] = [];
  for (const { map: name, keys } of normalized) {
    let observer = registry.maps.get(name);
    if (!observer) {
      const consumers = new Map<Subscriber, ReadonlySet<string> | undefined>();
      const pending = registry.pending;
      observer = {
        map: doc.getMap(name), consumers,
        observe: (events, transaction) => {
          const touched = new Set<string>();
          for (const event of events) {
            if (event.path.length > 0) touched.add(String(event.path[0]));
            else if (event instanceof Y.YMapEvent) {
              for (const key of event.keysChanged) touched.add(key);
            }
          }
          for (const [consumer, membership] of consumers) {
            if (membership && ![...touched].some(key => membership.has(key))) continue;
            let queued = pending.get(transaction);
            if (!queued) pending.set(transaction, queued = new Set());
            queued.add(consumer);
          }
        },
      };
      registry.maps.set(name, observer);
      observer.map.observeDeep(observer.observe);
    }
    observer.consumers.set(subscriber, keys === undefined ? undefined : new Set(keys));
    subscribedMaps.push(observer);
  }
  return () => {
    if (!subscriber.active) return;
    subscriber.active = false;
    for (const pending of registry.pending.values()) pending.delete(subscriber);
    for (const observer of subscribedMaps) {
      observer.consumers.delete(subscriber);
      if (!observer.consumers.size) {
        observer.map.unobserveDeep(observer.observe);
        for (const [name, registered] of registry.maps) {
          if (registered === observer) registry.maps.delete(name);
        }
      }
    }
    if (!registry.maps.size) {
      doc.off('afterTransaction', registry.flush);
      registry.pending.clear();
      registries.delete(doc);
    }
  };
}
