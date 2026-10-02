// ── 应用内控制台的**运行槽单例**（纯 Node 宿主，同 `console-run.ts` 的登记口径）──
//
// 为什么需要这一层、而不是在路由里 `createConsoleRunner()` 一次：Next 的 dev
// 热编译会把 route 模块**重新求值**（每次改文件都是一次新实例），于是
//   · 旧实例的 `current` 槽与挂在它上面的子进程句柄再也无人引用，而进程还在跑；
//   · 新实例看到的是一张空槽 → 界面显示「空闲」，用户再点一次就有了**两条**
//     `pnpm test` 在抢同一批资源（而用户完全不知道）。
// 这与壳侧 shell-tabs / 影片监看去重表踩的是同一个坑：**跨模块重求值要活下来
// 的东西挂在 `globalThis`**，键名带版本号（`??=` 只认键名，改语义时得换名字，
// 否则新老实例会共用一份形状已变的旧值）。
//
// 这里的槽只回答两件事：**谁在跑**、**跑过什么**。执行本体仍在 `console-run.ts`。

import { createConsoleRunner, type ConsoleRunner } from "./console-run";
import { MAX_HISTORY_ENTRIES } from "./console-limits";

/** 已完成的一条运行（界面「本次会话跑过什么」的条目）。 */
export interface ConsoleHistoryEntry {
  runId: string;
  command: string;
  /** 退出码；null = 没拿到（被信号掐掉 / 起不来）。 */
  exitCode: number | null;
  killed: boolean;
  durationMs: number;
  finishedAt: number;
}

interface ConsoleSlot {
  runner: ConsoleRunner;
  history: ConsoleHistoryEntry[];
}

/** 单例挂载点。键名带语义版本：`history` 的形状变化时要换名字。 */
const SLOT_KEY = "__comfyappConsoleSlot_v1";

type GlobalWithSlot = typeof globalThis & {
  [SLOT_KEY]?: ConsoleSlot;
};

/** 取（必要时建）当前进程的控制台槽。 */
export function consoleSlot(): ConsoleSlot {
  const g = globalThis as GlobalWithSlot;
  g[SLOT_KEY] ??= { runner: createConsoleRunner(), history: [] };
  return g[SLOT_KEY];
}

/** 记一条已完成的运行（只留最近 `MAX_HISTORY_ENTRIES` 条）。 */
export function recordConsoleHistory(
  slot: ConsoleSlot,
  entry: ConsoleHistoryEntry,
): void {
  slot.history.push(entry);
  if (slot.history.length > MAX_HISTORY_ENTRIES) {
    slot.history.splice(0, slot.history.length - MAX_HISTORY_ENTRIES);
  }
}

/**
 * 测试专用：清掉单例（用例之间不能互相看见对方的槽与历史）。
 *
 * 导出它而不是让用例自己删 `globalThis` 上的键：键名是**本模块**的实现细节，
 * 用例里抄一份字面量就会在改名时静默失效（`globalThis.__comfyappConsoleSlot_v1`
 * 永远是 undefined → 清空动作变成空操作 → 用例互相污染）。
 */
export function resetConsoleSlotForTest(): void {
  delete (globalThis as GlobalWithSlot)[SLOT_KEY];
}
