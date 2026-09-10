import fs from "node:fs";

/* ── 日志会话边界（面板只显示「本次运行」）────────────────────────────
 * 面板轮询的三个来源里，`dev`（log/launcher/dev-launcher.log）每次运行都
 * 覆盖重建，天然只有本次；而 `app-runtime` 是**追加不轮转**的，文件会一直
 * 累积历史运行的内容。于是「应用日志」面板首次打开、以及上次运行的日志文件
 * 被删/被锁改名回退重读时，都会把历史运行的行重新拉进面板——用户看到的一屏
 * 日志里混着上一次、上上次启动的内容。
 *
 * 本模块给出「本次运行从哪儿算起」的粒度：
 *   - `GET /api/logs/current`：把会话起点随轮询响应下发给面板；
 *   - `LogProvider`：用行时刻把它之前的内容挡在面板外
 *     （`log-store.ts` 的 `dropStaleEntries`）。
 *
 * 时间戳只能回答「文件有没有在本次运行期间被写过」，回答不了「本次内容从第
 * 几个字节开始」——所以不做字节级跳过。行的格式自带毫秒时间戳，按行比较即可
 * 精确切分，没有字节定位的模糊区。
 *
 * 锚点用 `log/launcher/dev-launcher.log` 的 mtime：双击链路每次运行都覆盖
 * 重建它，mtime 即本次启动时刻；页面重载不会改变它，因此同一次运行里起点稳定。
 */

/**
 * 会话起点：本次运行的开始时刻。
 *
 * 显式传入的起点优先（调用方已算出更精确的值时用它）；否则退回锚点
 * （dev-launcher.log 的 mtime）。两者都拿不到时返回 null——调用方此时不做
 * 时间线截断，宁可多显示几条历史行，也不能凭空丢掉本次运行的日志。
 */
export function resolveSessionStart(
  anchorMtimeMs: number | null,
  explicitStartMs: number | null = null,
): number | null {
  if (explicitStartMs !== null) return explicitStartMs;
  return anchorMtimeMs;
}

/**
 * 读取文件 mtime（毫秒）；不存在/不可读返回 null。
 * 调用方负责拼路径——本模块留在 `src/lib`（逻辑层），不做路径解析。
 */
export function fileMtimeMs(file: string): number | null {
  try {
    return fs.statSync(/*turbopackIgnore: true*/ file).mtimeMs;
  } catch {
    return null;
  }
}

/** 把时间戳钳进 [0, now]：读不到时间的边界行不该污染面板时间线。 */
export function clampLogTime(tsMs: number, nowMs: number): number {
  return Math.max(0, Math.min(tsMs, nowMs));
}
