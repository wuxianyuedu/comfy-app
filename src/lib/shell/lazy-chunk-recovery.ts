// ── 懒加载视图「分块加载失败」的自愈（ISSUE #1900）────────────────────────
//
// 症状：工作区里切到某一屏（设置 / 模型适配 / 资源库 …）时整屏崩成「页面出错
// 了」，控制台报一条 `ChunkLoadError`，正文是「`Failed to load chunk`
// /_next/static/chunks/<hash>.js」，来源标注为懒加载入口（`next/dynamic`
// 的 async loader）。刷新一下就好，但用户不知道要刷新。
//
// 成因（全在 dev server 一侧，不在业务代码）：这些屏都是 `next/dynamic` 懒加载
// 的，页面首帧只拿到「该去哪个分块」的哈希，真正的 `import()` 在点开那一屏时
// 才发出。而 dev server 在按需编译 / 整页重建 / HMR 落盘之后，先前渲染出来的
// 页面里那些哈希可能已经指向**被换掉的旧分块**——请求到达时那个文件已经不在
// （404 / 内容不是 JS），`import()` 只能 reject。
//
// 为什么不能只靠 error boundary 的「重试」：`reset()` 重新渲染的是同一棵树，
// 而它手里的分块哈希还是旧的那一份 —— 重试必然再撞同一堵墙。真正的解法是
// **让浏览器重新向 dev server 要一份页面**（拿新的哈希），也就是刷新。
//
// 因此这里做两件事，且只做两件：
//   ① `isChunkLoadFailure(err)` —— 判定「这是分块加载失败」（纯函数，可单测）；
//   ② `reloadOnceForChunkError(err)` —— 命中且**这一轮故障还没刷过**时整页刷新。
//
// 为什么要有「同一轮故障只刷一次」这道闸：分块是真的被删掉（而非换了哈希）时，
// 刷新也拿不到它，没有闸就是**刷新死循环**——比一条报错更坏。同一轮里刷过一次
// 仍失败就把错误照常抛给 error boundary，让用户看到「页面出错了 + 重试」。
// 「同一轮」的边界是冷却窗口（`RELOAD_COOLDOWN_MS`）——写成「这台浏览器一辈子
// 只刷一次」是错的：dev server 每重建一次就换一批分块，那样做等于第一次故障
// 之后永久失去自愈。
//
// 只在 dev 生效：生产构建里分块名是构建期定的、不会被换掉，这条路径不该出现在
// 用户机上（真出现就是产物缺件，那种故障必须显式暴露，见硬规则 18）。

import { readStorageItem, writeStorageItem } from "~/lib/browser-storage";

/** 上一次因分块失败刷新的时间戳（毫秒）：写下即表示那一轮的机会用过了。 */
const RELOAD_GUARD_KEY = "chunkReload.doneAt";

/**
 * 两轮自愈刷新之间的最短间隔（`60` 秒）——「同一轮故障」的判据。
 *
 * 闸的**形状**此前是「标记写过就不再刷」，而那个标记没有任何地方会清（`localStorage`
 * 只增不减、也不随标签页关闭消失），于是「本会话刷一次」在实现上退化成了
 * **「这台浏览器一辈子只刷一次」**：第一次自愈之后，dev server 每重建一次
 * （换一批分块）都会回到裸的 `ChunkLoadError`——用户看到的就是「点开某一屏
 * 整屏崩、怎么点都不恢复」，正是这条判据本来要治的症状。
 *
 * 冷却窗口把「一轮故障」与「两轮故障之间的正常间隔」分开：窗口内不刷第二次
 * （刷新死循环照旧防住），隔得比它久的就是新的一轮，该给的机会还给。
 *
 * 取 60 秒的理由：一轮真故障的自愈周期（刷新 → dev server 重新编译 → 用户再
 * 点开那一屏）通常远短于它；而分块真被删掉时最坏也只是每分钟多刷一次，不成风暴。
 */
const RELOAD_COOLDOWN_MS = 60_000;

/**
 * 「这是分块加载失败」的判据。
 *
 * 认的是浏览器与打包器给出的**固定形态**，不认业务错误：
 *   · `ChunkLoadError` —— webpack / Turbopack 的 `import()` 失败错误名；
 *   · `Failed to load chunk` —— Turbopack dev 的报错正文（现场原句）；
 *   · `Loading chunk N failed` / `Loading CSS chunk` —— webpack 形态；
 *   · `Failed to fetch dynamically imported module` —— 浏览器原生 ESM 形态
 *     （Firefox / Safari 对动态 import 网络失败给的就是这句）。
 *
 * 按钮文案里的「加载失败」一类措辞**不**在这里认——那会把「数据库读不到」
 * 这类业务故障也当成可以刷新的分块问题，刷新救不了它们，只会白刷一次。
 */
export function isChunkLoadFailure(err: unknown): boolean {
  const text =
    err instanceof Error
      ? `${err.name}: ${err.message}`
      : typeof err === "string"
        ? err
        : "";
  if (!text) return false;
  return (
    /ChunkLoadError/i.test(text) ||
    /Failed to load chunk/i.test(text) ||
    /Loading (?:CSS )?chunk .* failed/i.test(text) ||
    /Failed to fetch dynamically imported module/i.test(text)
  );
}

/**
 * 命中分块加载失败时整页刷新一次（同一轮故障至多一次）。
 *
 * 返回值表示「这次调用是否真的触发了刷新」——调用方据此决定还要不要把错误
 * 继续抛出去：刷了就让它随导航自然消失，没刷（同一轮已刷过 / 不是分块问题）
 * 就照常抛，用户至少看得到 error boundary 的「重试」。
 *
 * 非浏览器环境（SSR / 单测）与生产构建一律不刷，直接返回 false。
 */
export function reloadOnceForChunkError(err: unknown): boolean {
  if (typeof window === "undefined") return false;
  if (process.env.NODE_ENV === "production") return false;
  if (!isChunkLoadFailure(err)) return false;

  /* 同一轮刷过就不再刷：分块真的没了时，第二次刷新同样拿不到它——那会变成
   * 死循环，比把错误抛给 error boundary 更坏。判据是**距上次刷新的间隔**，不是
   * 「有没有刷过」：后者没有任何地方会清，自愈能力会用一次就永久消失
   * （见 `RELOAD_COOLDOWN_MS`）。 */
  const lastReloadAt = Number.parseInt(
    readStorageItem(RELOAD_GUARD_KEY) ?? "",
    10,
  );
  if (
    Number.isFinite(lastReloadAt) &&
    Date.now() - lastReloadAt < RELOAD_COOLDOWN_MS
  ) {
    return false;
  }

  writeStorageItem(RELOAD_GUARD_KEY, String(Date.now()));
  window.location.reload();
  return true;
}
