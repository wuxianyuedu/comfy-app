/* ── 日志会话起点的**服务端** IO 部分（Node-only）─────────────────────
 *
 * 读文件 mtime 需要 fs，只能留在服务端（理由见 `log-session-scope.ts`
 * 文件头的「为什么不得 import node:fs」）。客户端组件（LogProvider）只
 * import 纯函数那个文件，因此浏览器 bundle 里不会再出现 `node:fs`。
 *
 * 文件名以 `.server.ts` 结尾是仓库既有约定（同 `api-channel.server.ts` /
 * `script-parser` 一类），提示「这是 Node-only 模块，不要从客户端引用」。
 */

import fs from "node:fs";

/**
 * 读取文件 mtime（毫秒）；不存在/不可读返回 null。
 * 调用方负责拼路径——本模块留在 `src/lib`（逻辑层），不做路径解析。
 *
 * 异步（ISSUE #2193）：它的调用点在 `GET /api/logs/current` 那条**每 2s 一轮**的
 * 轮询链上，而同步 `stat` 占住的是事件循环线程 —— 代价由当时所有并发请求一起付，
 * 不只是这一条轮询。语义一字未改（读不到仍回 null，不替调用方编一个起点）。
 */
export async function fileMtimeMs(file: string): Promise<number | null> {
  try {
    const stat = await fs.promises.stat(/*turbopackIgnore: true*/ file);
    return stat.mtimeMs;
  } catch {
    return null;
  }
}
