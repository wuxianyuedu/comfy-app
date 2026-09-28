import "server-only";

// 底部状态栏那一格的**服务端聚合**：ComfyUI 的全局排队 + 本应用当前在跑什么。
//
// 三条数据来源，缺一不可，且**全部来自库里那几行**（P3 §5 ADR §14 D1 的 4-B2）：
//   · **本应用排队 / 在跑哪个任务** —— `task` 表的 `status`（跨归属：这一格答的是
//     「本应用」，inline 与 host 两片的行都算）；
//   · **工作流名 / 进度 / 当前节点 / 已运行多久** —— 同一行的 `workflowName`、
//     `progress`、`progressNode`、`claimedAt`；
//   · **ComfyUI 自己的口径** —— `/queue`。这一路才看得到「不是本应用提交」的任务
//     （用户在 ComfyUI 原生界面排的队），也才回答得了「全局排了多少」。
//
// 为什么不再读执行进程的内存（此前是 `runnerState` 的 `queue` / `startedAt` /
// `executedWorkflow` / `lastNodeByTask` 四样）：执行权已经可以归另一个宿主进程，
// 内存版在 host 模式下恒为「排队 0、在跑 null」——用户最想知道的那两件事正好没有。
// 现在两模式同一契约，且这一格比原来更准：排队数来自库，重启后也不会归零。
//
// 为什么值得单独一格：`MAX_CONCURRENCY=1`，任务全在串行排队。用户看着画布上某个
// 节点转圈时，最想知道的正是「前面还堵着几个、当前这个跑了多久、跑的是哪个
// 工作流与模型」。
//
// `online` 不只认 HTTP（ISSUE：队列页「未运行」闪一下）：ComfyUI 跑图 GPU 满载时
// `/queue` 会**连续**超时，只认 HTTP 会把「正在生成」闪报成「离线」。HTTP 那拍
// 没读到时回落进程级快照（`status.ts`，不依赖 ComfyUI 的 HTTP 响应能力）——
// 进程活着就仍算在线。快照的 `unverified`（进程表也查失败）不当作在跑，
// 瞬时抖动由前端 `useOfflineGate` 的连续失败阈值兜底。

import { taskRepository } from "../core/repository-task";
import { getComfyQueue } from "./client";
import { primaryModelName } from "./executed-model";
import { getComfyRuntimeSnapshot } from "./status";
import { queueTraceSummary } from "./trace";
import type { ComfyQueueStatus, ComfyRunningTask } from "./queue-status-types";

/** 采集一次状态栏那一格要的全部数据。 */
export async function collectComfyQueueStatus(): Promise<ComfyQueueStatus> {
  const [running, comfy, queued] = await Promise.all([
    describeRunning(),
    describeComfy(),
    taskRepository.countQueuedForStatusBar(),
  ]);
  if (comfy !== null) {
    return { online: true, comfy, running, queued };
  }
  /* HTTP 没读到：回落「进程在不在」。comfy 计数置 0 的含义是「这一拍没读到
   * ComfyUI 自己的口径」，不是「队列空了」——本应用的排队数（`queued`）来自库，
   * 不受影响。 */
  const snap = await getComfyRuntimeSnapshot();
  return {
    online: snap.running,
    comfy: { running: 0, pending: 0 },
    running,
    queued,
  };
}

/** 本应用当前在跑的那一个（跨宿主，取自库里那行）。 */
async function describeRunning(): Promise<ComfyRunningTask | null> {
  const row = await taskRepository.findRunningForStatusBar();
  if (!row) return null;

  /* 开始时刻优先用 `claimedAt`（领取 / 首次转 RUNNING 时定格，见 schema 那一段的
   * 说明）；那列为 NULL 的只有本字段上线之前就存在的 RUNNING 行，用提交时刻近似
   * 总好过让这一格的耗时空着。 */
  const startedAt = (row.claimedAt ?? row.createdAt).getTime();

  /* `progressNode` 是执行侧写的 JSON 快照（`{id,label?,classType?,value,max}`）：
   * 画布要的是中文 `label`，这一格历史上显示的是**类名**，所以两个都存着读。
   * cli 那条进度事件源拿不到 `class_type`（raw 图不在手上），此时为 null——与
   * 内存版的旧行为一致，不是新缺口。 */
  const node =
    row.progressNode && typeof row.progressNode === "object"
      ? (row.progressNode as { classType?: unknown })
      : null;

  return {
    taskId: row.id,
    workflowName: row.workflowName,
    /* 主模型从**提交时刻的图**里认（`executed-model.ts` 两种格式都支持）：库里
     * 只有 `execPayload` 是执行侧一定会写的，`workflowSnapshot` 要到成功收口才落，
     * 而这一格要的正是「现在在跑的这个用的什么模型」。 */
    model: primaryModelName(row.execPayload),
    startedAt,
    progress: row.progress,
    nodeType: typeof node?.classType === "string" ? node.classType : null,
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
