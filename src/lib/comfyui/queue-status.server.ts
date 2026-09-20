import "server-only";

// 底部状态栏那一格的**服务端聚合**：ComfyUI 的全局排队 + 本应用当前在跑什么。
//
// 三条数据来自三个地方，缺一不可：
//   · **本应用排队 / 在跑哪个任务** —— 执行器内存态（`runner-state` 的 `queue`
//     与 `startedAt`）。它是唯一知道「这一条是本次应用提交的」的地方；
//   · **工作流名 / 进度** —— DB 的 `Task` 行（内存态里没有这两样）；
//   · **ComfyUI 自己的口径** —— `/queue`。这一路才看得到「不是本应用提交」
//     的任务（用户在 ComfyUI 原生界面排的队），也才回答得了「全局排了多少」。
//
// 为什么值得单独一格：MAX_CONCURRENCY=1，任务全在串行排队。用户看着画布上某个
// 节点转圈时，最想知道的正是「前面还堵着几个、当前这个跑了多久、跑的是哪个
// 工作流与模型」——这些在此之前只散在日志面板里，且**耗时根本没暴露过**
// （`startedAt` 只在任务结束时被算成一句文本日志）。

import { taskRepository } from "../core/repository-task";
import { getComfyQueue } from "./client";
import { primaryModelName } from "./executed-model";
import { state } from "./runner-state";
import { queueTraceSummary } from "./trace";
import type { ComfyQueueStatus, ComfyRunningTask } from "./queue-status-types";

/** 采集一次状态栏那一格要的全部数据。 */
export async function collectComfyQueueStatus(): Promise<ComfyQueueStatus> {
  const s = state();
  const [running, comfy] = await Promise.all([
    describeRunning(),
    describeComfy(),
  ]);
  return {
    online: comfy !== null,
    comfy: comfy ?? { running: 0, pending: 0 },
    running,
    queued: s.queue.length,
  };
}

/** 本应用当前在跑的那一个。 */
async function describeRunning(): Promise<ComfyRunningTask | null> {
  const store = state();
  /* `startedAt` 里最多一条：enqueue 时写入，完成 / 失败 / 取消时清除，而
   * MAX_CONCURRENCY=1 —— 所以第一条就是「当前在跑的那个」，不需要额外的归属
   * 判据（promptId → taskId 的映射在 raw 路径上拿不到，comfy-cli 自己生成
   * client_id，见 reaper 里同一处限制）。 */
  const entry = [...store.startedAt.entries()][0];
  if (entry === undefined) return null;
  const [taskId, startedAt] = entry;

  /* 工作流名与进度只有 DB 有。查询失败**不该让整格消失** —— 状态栏宁可少显示
   * 一个名字，也不该在此时整条不见（那时用户正盯着进度看）。 */
  const row = await taskRepository.findById(taskId).catch(() => null);

  return {
    taskId,
    workflowName: row?.workflowName ?? null,
    model: primaryModelName(store.executedWorkflow.get(taskId)),
    startedAt,
    progress: row?.progress ?? 0,
    nodeType: store.lastNodeByTask.get(taskId)?.classType ?? null,
  };
}

/** ComfyUI 自己的排队口径；不可达时 null（调用方降级成「离线」）。 */
async function describeComfy(): Promise<{
  running: number;
  pending: number;
} | null> {
  const raw = await getComfyQueue();
  if (raw === null) return null;
  /* 解析只走 `queueTraceSummary` 一处（reaper 的对账用的是同一份）——`/queue`
   * 的条目形态随版本变，两处各解一遍必然分叉。 */
  const { running, pending } = queueTraceSummary(raw);
  return { running: running.length, pending: pending.length };
}
