/* ── 日志会话边界（面板只显示「本次运行」）────────────────────────────
 *
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
 *
 * ── 为什么本模块**不得** import `node:fs`（重要）───────────────────────
 * `LogProvider.tsx` 是客户端组件（"use client"），它只是要一个纯函数
 * `clampLogTime`。若本模块顶层 `import fs from "node:fs"`，Turbopack 编译
 * 浏览器 chunk 时会把 `node:fs` 整图形入，报
 * `the chunking context does not support external modules (request: node:fs)`
 * 并让整个 endpoint 编译失败——**`/login` 与 `/workspace` 都会 500**，
 * 应用完全打不开。
 *
 * 这与 `app-runtime-log.ts` 的历史回归（ISSUE #282 / §7.12）同源：Node-only
 * 模块被静态打包进浏览器图。因此这里做**分层**：
 *   - 本文件只放纯函数（同时服务客户端与服务端）；
 *   - 读文件 mtime 这类 IO 归 `log-session-scope.server.ts`（Node-only）。
 * 客户端与服务端都只 import 本文件，IO 只在服务端路由里 import 后者。
 *
 * 同理，注释里的 `node:fs` 也必须写成不可被静态分析识别为 import 的形式——
 * 上面对它的提及是文字说明，不是 import 语句。
 */

/**
 * 会话起点：本次运行的开始时刻。
 *
 * 显式传入的起点优先（调用方已算出更精确的值时用它）；否则退回锚点
 * （dev-launcher.log 的 mtime）。两者都拿不到时返回 null——调用方此时不做
 * 时间线截断，宁可多显示几条历史行，也不能凭空丢掉本次运行的日志。
 */
import { clamp } from "~/lib/clamp";

export function resolveSessionStart(
  anchorMtimeMs: number | null,
  explicitStartMs: number | null = null,
): number | null {
  if (explicitStartMs !== null) return explicitStartMs;
  return anchorMtimeMs;
}

/** 把时间戳钳进 [0, now]：读不到时间的边界行不该污染面板时间线。 */
export function clampLogTime(tsMs: number, nowMs: number): number {
  return clamp(tsMs, 0, nowMs);
}
