/**
 * `executor-mode.ts` — 「本任务由谁执行」判据的唯一定义（P3 §5 ADR §6/§13-3B1）
 *
 * 读 `COMFY_EXECUTOR` env：`host` → 行落 `claimedBy='host'`、Next 侧**不**在进程内
 * `enqueue()`（由 executor host 轮询领取）；其余（含未设/空）→ `'inline'`，
 * 行为与现状逐字一致。非法值不猜意图：warn 一行后按 inline——与
 * `dev-launcher.mjs` 对同一 env 的门控判据同形（大小写不敏感、未知即回退）。
 *
 * env 来源的两侧差异要知道：Next server 侧 `.env` 由 @next/env 注入
 * `process.env`（这里直接读即覆盖，且**进程里给了值就不再被 `.env` 顶掉**）；
 * launcher / host 是纯 Node、不注入 `.env`，它们共用
 * `scripts/launcher-core/executor-mode.mjs` 那份「进程 env → `.env` 回读 → 默认」
 * （P3 §5 ADR §14 D5：这一层此前是两处各写一遍，host 那份漏 trim 与回读，
 * 造成「Next 写 host 片、host 起骨架」的静默错配）。本模块与那份纯 Node 实现
 * 是否逐值同判决，由 `tests/executor-mode-consistency.test.ts` 钉住
 * （跨层不能合成一份：要么给 launcher 引入 tsx，要么让 `src/lib` 去 import
 * `scripts/`，两条都撞既有约束）。
 *
 * §18.4 三选一：第三类（纯 Node 宿主可加载）——无 `server-only`、无 Node 内建
 * value import，host 若将来需要同一判据可直接 import 本模块。
 */
import { logger } from "../core/logger";
import type { TaskClaimMode } from "../core/repository-task-impl";

/** 归一化后的执行器归属；NULL 语义（历史行）不在本模块产出，只被 inline 片吸收。
 *  调用点用返回值同时决定两件事：`createQueued({ claimedBy })` 与
 *  `if (claim === "inline") enqueue(...)`——同一个判据读一次，不分两个函数防漂移。 */
export function resolveExecutorClaim(): TaskClaimMode {
  const raw = (process.env.COMFY_EXECUTOR ?? "").trim().toLowerCase();
  if (raw === "host") return "host";
  if (raw === "" || raw === "inline") return "inline";
  warnUnknownOnce(raw);
  return "inline";
}

let warnedUnknown = false;
function warnUnknownOnce(raw: string): void {
  if (warnedUnknown) return;
  warnedUnknown = true;
  logger.warn(
    `[comfyui] COMFY_EXECUTOR="${raw}" 不识别，按 inline 执行（可选：inline|host）`,
  );
}
