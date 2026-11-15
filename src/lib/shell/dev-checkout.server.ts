// ── 「这份检出是不是开发检出」的唯一判据（服务端）─────────────────────────
//
// 判据是**检出里有没有启动编排器** `scripts/dev-launcher.mjs`：它在 = 源码在手，
// 「保存为项目默认」才有可写的目标文件；standalone 分发载荷里没有编排器，这一格
// 必为 false。
//
// 为什么搬到 `src/lib/shell/`：它是**应用形态**的判据（规范 §1.5「一个 exe，两种
// 形态」），不是某个业务域的私事 —— 「模式契约」与「侧栏页签行为」两处配置面
// 都要用它。各写一份判据就会在某一处漂移，而漂移的表现是「正式包里的那个按钮
// 该藏却没藏」。
//
// 本模块带 `server-only`：它读文件系统，属于纯 Node 宿主侧（§18.4 的三选一之
// 「`.server.ts`」）。

import "server-only";

import { existsSync } from "node:fs";
import path from "node:path";

/**
 * 这份检出是不是**开发检出**（正式包形态的反面）。
 *
 * 判据与壳的形态判据同一条：检出里有启动编排器 `scripts/dev-launcher.mjs`。
 */
export function isDevCheckout(root: string = process.cwd()): boolean {
  return existsSync(path.join(root, "scripts", "dev-launcher.mjs"));
}
