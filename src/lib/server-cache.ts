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

import { isRecord } from "~/lib/is-record";

type Entry<T> = { expiresAt: number; value: T };

/** 缓存条目只由本模块写入：读到它即意味着同 key 的上一次写入成功，值就是那次
 *  构建的结果。这里在运行期核对条目形状（对象且带 `value`），而不是靠断言宣称。 */
function assertEntryValue<T>(entry: unknown): asserts entry is Entry<T> {
  if (!isRecord(entry) || !Object.hasOwn(entry, "value")) {
    throw new TypeError("server-cache: 缓存条目形状不合法");
  }
}

type CacheStore = {
  /** 失效代次：每次 `cacheDel` / `cacheDelPrefix` 自增。回填前比对——构建期间
   *  被失效过的结果基于旧数据，不得写回缓存（否则 PATCH 后 TTL 内一直读旧值）。 */
  gen: number;
  /** per-key single-flight：同一 key 的并发未命中共享同一次构建，不重复跑。 */
  inflight: Map<string, Promise<unknown>>;
  map: Map<string, Entry<unknown>>;
  max: number;
};

const MAX_ENTRIES = 256;

declare global {
  var __comfyServerCache: CacheStore | undefined;
}

function getStore(): CacheStore {
  return (globalThis.__comfyServerCache ??= {
    map: new Map(),
    gen: 0,
    inflight: new Map(),
    max: MAX_ENTRIES,
  });
}

/**
 * 值仍新鲜则返回缓存；否则调用 `build`（可以是异步的），存下结果并返回。
 *
 * - **single-flight**：同一 key 的并发未命中只跑一次 `build`，其余共享同一 Promise；
 * - **失效安全**：`build` 期间若发生 `cacheDel` / `cacheDelPrefix`（代次变化），
 *   本次结果不再回填——它派生自失效前的旧数据；
 * - `build` 抛错时不缓存任何东西，错误原样透传给所有等待者。
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
    assertEntryValue<T>(existing);
    return existing.value;
  }

  const pending = store.inflight.get(key);
  if (pending) {
    /* single-flight：同一 key 的并发未命中共享同一次构建。这里只借**时序**——
     * 等那次构建落定，值改从缓存条目里取（与命中路径同一套运行时形状守卫，
     * 不做 `unknown → T` 断言）。构建失败或结果在构建期间被失效 → 这一拍没有
     * 可复用的条目，按未命中继续走下面的构建（不再嵌套 single-flight）。 */
    await pending.catch(() => undefined);
    const landed = store.map.get(key);
    if (landed && landed.expiresAt > Date.now()) {
      store.map.delete(key);
      store.map.set(key, landed);
      assertEntryValue<T>(landed);
      return landed.value;
    }
  }

  const genAtStart = store.gen;
  const task = (async () => build())();
  store.inflight.set(key, task);
  let value: T;
  try {
    value = await task;
  } finally {
    store.inflight.delete(key);
  }

  if (store.gen === genAtStart) {
    const entry: Entry<T> = { value, expiresAt: now + ttlMs };
    store.map.delete(key);
    store.map.set(key, entry);

    // 超出容量就淘汰最旧的。
    while (store.map.size > store.max) {
      const oldest = store.map.keys().next().value;
      if (oldest === undefined) {
        break;
      }
      store.map.delete(oldest);
    }
  }
  return value;
}

/* 删除单个缓存键。 */
export function cacheDel(key: string): void {
  const store = getStore();
  store.gen += 1;
  store.map.delete(key);
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
    assertEntryValue<T>(existing);
    return existing.value;
  }
  return undefined;
}

/* 删除所有以 `prefix` 开头的缓存键（例如 `wf:userId:`）。 */
export function cacheDelPrefix(prefix: string): void {
  const store = getStore();
  let removed = false;
  for (const k of store.map.keys()) {
    if (k.startsWith(prefix)) {
      store.map.delete(k);
      removed = true;
    }
  }
  if (removed) {
    store.gen += 1;
  }
}
