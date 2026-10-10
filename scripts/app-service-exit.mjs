#!/usr/bin/env node
// 「应用服务为什么断了」的落盘侧（启动编排与桌面壳共用同一份判据与字段名）。
//
// 背景（ISSUE #1692）：状态栏那一格只会在探测失败时翻成「应用服务已断开」——
// 用户知道断了，但不知道**为什么**。而探测走的是应用服务自己的 HTTP，服务一旦
// 不在，这条通道必然不通：此刻再去「问它为什么没了」是问不到的。于是原因只能在
// **它死的那一刻**由旁证人写下、写在一个服务不在也能读的地方。
//
// 旁证人有两个，本模块服务它们共同的落盘格式：
//   · `scripts/dev-launcher.mjs` 的收尾定性（dev / prebuilt 链路）——
//     它本来就判出了 `downstreamExitKind` 与 dev 的 exitCode / signalCode；
//   · 桌面壳（Rust）的 sidecar `Terminated` 事件（standalone 内嵌 server）——
//     壳活着、服务没了，正是用户看到的「窗口还在、页面全连不上」。
//
// 读取侧只有一条存活通道：Tauri 壳的 IPC（`get_app_service_exit`），它不经死掉
// 的服务。**字段名与成因取值必须与 `src/lib/shell/app-service-exit.ts` 逐字一致**
// ——漂开的表现是「记录写进去了、界面读不懂」，而现场恰好是最需要看清的那一次。
// 两份的同源性由 `tests/app-service-exit-contract.test.ts` 逐项核对。
//
// 落点：`run/app-service-exit.json`（与 `run/launch-status.json` 并列，同属
// 「本次运行的现场」，见规范 §4 / 本目录 `dev-launcher-session.mjs` 的布局表）。

import fs from "node:fs";
import path from "node:path";

/** 记录文件名（`run/` 下，与 launch-status.json 并列）。 */
export const APP_SERVICE_EXIT_FILE = "app-service-exit.json";

/**
 * 记录文件的绝对路径。
 * @param {string} root @returns {string}
 */
export function appServiceExitPath(root) {
  return path.join(root, "run", APP_SERVICE_EXIT_FILE);
}

/**
 * 写下「应用服务为什么结束」。
 *
 * **必须在回收整棵进程树之前调用**：本记录的用途正是「事后问不了它」，写完再
 * 收尾的顺序是语义的一部分。
 *
 * 写失败一律静默（返回 false）：这条记录是排障体验，不是启动的必要条件；它写不
 * 进去时界面按「没有原因可讲」处理，不会因为日志/磁盘问题反过来挡住启动或收尾。
 *
 * @param {string} root 项目根（`run/` 的锚点）
 * @param {{ kind: string, code?: number | null, signal?: string | null, reason: string,
 *   port?: number | null, runId?: string | null, at?: Date }} input 结束事实
 * @returns {boolean} 落盘是否成功（失败静默，不阻断收尾）
 */
export function writeAppServiceExit(root, input) {
  const body = {
    at: (input.at ?? new Date()).toISOString(),
    kind: input.kind,
    code: typeof input.code === "number" ? input.code : null,
    signal: typeof input.signal === "string" && input.signal ? input.signal : null,
    reason: input.reason,
    port: typeof input.port === "number" ? input.port : null,
    runId: typeof input.runId === "string" && input.runId ? input.runId : null,
  };
  try {
    const dir = path.join(root, "run");
    fs.mkdirSync(dir, { recursive: true });
    // 无 BOM（读取侧 JSON.parse 遇 BOM 会失败），与 launch-status.json 同口径。
    fs.writeFileSync(
      path.join(dir, APP_SERVICE_EXIT_FILE),
      JSON.stringify(body),
      "utf8",
    );
    return true;
  } catch {
    return false;
  }
}
