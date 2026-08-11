/**
 * In-memory LRU + TTL cache for server-side route responses.
 *
 * Used to skip the expensive per-request transform of ComfyUI rawJson
 * (rawInputsById / rawNodeMeta / groups / notes / paramMap) when the same
 * workflow detail is requested repeatedly (e.g. opening the same canvas).
 *
 * Notes:
 * - Pure `Map` + insertion order gives us O(1) LRU eviction via re-insert.
 * - Stored on `globalThis` so the cache survives Next.js HMR / module
 *   re-evaluation in `next dev` (otherwise the Map resets every hot reload).
 * - The cached payloads are derived purely from `tpl.rawJson` / `tpl.graph`,
 *   which never change between writes, so TTL invalidation is safe.
 */

type Entry<T> = { value: T; expiresAt: number };

interface CacheStore {
  map: Map<string, Entry<unknown>>;
  max: number;
}

const MAX_ENTRIES = 256;

function getStore(): CacheStore {
  const g = globalThis as unknown as { __comfyServerCache?: CacheStore };
  if (!g.__comfyServerCache) {
    g.__comfyServerCache = { map: new Map(), max: MAX_ENTRIES };
  }
  return g.__comfyServerCache;
}

/**
 * Return a cached value if still fresh, otherwise call `build` (which may be
 * async), store the result, and return it.
 */
export async function cacheJson<T>(
  key: string,
  ttlMs: number,
  build: () => T | Promise<T>
): Promise<T> {
  const store = getStore();
  const now = Date.now();
  const existing = store.map.get(key);
  if (existing && existing.expiresAt > now) {
    // Re-insert to mark as most-recently-used.
    store.map.delete(key);
    store.map.set(key, existing);
    return existing.value as T;
  }

  const value = await build();
  const entry: Entry<T> = { value, expiresAt: now + ttlMs };
  store.map.delete(key);
  store.map.set(key, entry as Entry<unknown>);

  // Evict oldest if over capacity.
  while (store.map.size > store.max) {
    const oldest = store.map.keys().next().value;
    if (oldest === undefined) break;
    store.map.delete(oldest);
  }
  return value;
}

/** Remove a single cached key. */
export function cacheDel(key: string): void {
  getStore().map.delete(key);
}

/**
 * Return a cached value if still fresh, WITHOUT building/re-building.  Used to
 * short-circuit the full request (skip the DB read + JSON serialization that
 * would otherwise run on every hit).  Returns `undefined` on miss/expiry.
 */
export function cachePeek<T>(key: string): T | undefined {
  const store = getStore();
  const existing = store.map.get(key);
  if (existing && existing.expiresAt > Date.now()) {
    // Re-insert to mark as most-recently-used.
    store.map.delete(key);
    store.map.set(key, existing);
    return existing.value as T;
  }
  return undefined;
}

/** Remove every cached key beginning with `prefix` (e.g. `wf:userId:`). */
export function cacheDelPrefix(prefix: string): void {
  const store = getStore();
  for (const k of Array.from(store.map.keys())) {
    if (k.startsWith(prefix)) store.map.delete(k);
  }
}
