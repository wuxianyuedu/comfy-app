/**
 * `task-state.ts` — 任务状态的终态判据（纯逻辑，客户端 / 服务端共用）
 * @module lib/task-state — 终态判据的模块路径
 *
 * 为什么需要收口：`SUCCEEDED / FAILED / CANCELLED` 这三个「终态」的判据
 * 此前散落在至少四处（执行器的收口守卫、SSE 流的关流条件、取消端点的
 * 跳过条件、画布加载时对账的展示分支），各写各的字面量。任何一处写漏，
 * 表现都是「已经结束的任务还在被当成在跑」——例如收口之后又被写入一次
 * 进度或状态，DB 行从终态被打回 RUNNING，`/api/tasks/[id]/stream` 的
 * 3s 轮询先看到终态关掉了流，之后再也翻不回来，卡片永远停在「生成中…」。
 *
 * 本模块只放判据，不做 IO，因此**端与服务端都能引**——它必须留在 `src/lib`
 * 根层（element `lib`）：`src/lib/core/**` 被划为 element `server`，视图层
 * 一旦 import 就会被 `eslint.config.js` 的 `boundaries` 拦下（组件需要这个
 * 判据来决定「终态帧怎么呈现」）。服务端 SQL 侧那份数组是它的派生值，
 * 见 `~/lib/core/repository-task` 的 `TERMINAL_STATES`。
 */

/** 任务的全部终态：到达其中任一状态后，结果不再改变。 */
export const TERMINAL_TASK_STATUSES = [
  "SUCCEEDED",
  "FAILED",
  "CANCELLED",
] as const;

export type TerminalTaskStatus = (typeof TERMINAL_TASK_STATUSES)[number];

/** 该状态是否已终态。null / undefined（行还不存在）不算终态。 */
export function isTerminalTaskStatus(
  status: string | null | undefined,
): status is TerminalTaskStatus {
  return (
    status === "SUCCEEDED" || status === "FAILED" || status === "CANCELLED"
  );
}

/** 该状态是否「终态失败」（终态且非成功）：失败原因在这里才有意义。 */
export function isTerminalFailureTaskStatus(
  status: string | null | undefined,
): boolean {
  return status === "FAILED" || status === "CANCELLED";
}

/** 该状态是否「还在进行中」（尚未终态）。 */
export function isActiveTaskStatus(status: string | null | undefined): boolean {
  return !isTerminalTaskStatus(status);
}
