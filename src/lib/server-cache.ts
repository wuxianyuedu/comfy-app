/* 服务端路由响应用的「内存 LRU + TTL 缓存」。
 *
 * 用于跳过 ComfyUI rawJson 那套昂贵的「每请求重算」
 *（即 rawInputsById、rawNodeMeta、groups、notes、paramMap 这五项）——
 * 当同一份工作流详情被反复请求时（例如反复打开同一个画布）。
 *
 * 说明：
 * - 纯 `Map` + 插入顺序，配合「重新插入」即得 O(1) 的 LRU 淘汰。
 * - 挂在 `globalThis` 上，让缓存在 `next dev` 的 HMR 与模块重求值中存活
 *  （否则每次热重载 Map 都会重置）。
 * - 缓存载荷完全派生自 `tpl.rawJson` / `tpl.graph`，它们在两次写入之间不变，
 *   因此按 TTL 失效是安全的。
 */

type Entry<T> = { value: T; expiresAt: number };

interface CacheStore {
  map: Map<string, Entry<unknown>>;
  max: number;
}

const MAX_ENTRIES = 256;

declare global {
  var __comfyServerCache: CacheStore | undefined;
}

function getStore(): CacheStore {
  return (globalThis.__comfyServerCache ??= {
    map: new Map(),
    max: MAX_ENTRIES,
  });
}

/**
 * 值仍新鲜则返回缓存；否则调用 `build`（可以是异步的），
 * 存下结果并返回。
 */
export async function cacheJson<T>(
  key: string,
  ttlMs: number,
  build: () => T | Promise<T>,
): Promise<T> {
  const store = getStore();
  const now = Date.now();
  const existing = store.map.get(key);
  if (existing && existing.expiresAt > now) {
    // 重新插入一次，以标记为「最近使用」。
    store.map.delete(key);
    store.map.set(key, existing);
    return existing.value as T;
  }

  const value = await build();
  const entry: Entry<T> = { value, expiresAt: now + ttlMs };
  store.map.delete(key);
  store.map.set(key, entry);

  // 超出容量就淘汰最旧的。
  while (store.map.size > store.max) {
    const oldest = store.map.keys().next().value;
    if (oldest === undefined) break;
    store.map.delete(oldest);
  }
  return value;
}

/* 删除单个缓存键。 */
export function cacheDel(key: string): void {
  getStore().map.delete(key);
}

/**
 * 值仍新鲜则返回缓存，但**不**构建 / 重建。用于提前短路整个请求
 *（跳过每次命中本来都要跑的数据库读取与 JSON 序列化）。
 * 未命中或已过期时返回 `undefined`。
 */
export function cachePeek<T>(key: string): T | undefined {
  const store = getStore();
  const existing = store.map.get(key);
  if (existing && existing.expiresAt > Date.now()) {
    // 重新插入一次，以标记为「最近使用」。
    store.map.delete(key);
    store.map.set(key, existing);
    return existing.value as T;
  }
  return undefined;
}

/* 删除所有以 `prefix` 开头的缓存键（例如 `wf:userId:`）。 */
export function cacheDelPrefix(prefix: string): void {
  const store = getStore();
  for (const k of Array.from(store.map.keys())) {
    if (k.startsWith(prefix)) store.map.delete(k);
  }
}
