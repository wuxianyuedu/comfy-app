/**
 * task-log-progress —— 从任务执行日志解析「分节点进度」的纯函数层。
 *
 * 日志里的 `[comfy-cli 原始]` 行是 comfy-cli 的原始 JSON 事件（minimax-h3-image
 * 实测：`progress` 事件按节点带 `completed`/`total`——文本生成节点逐 token
 * （total=8192）、KSampler 按步数；`executing` 事件带节点的 `title`/`class_type`；
 * `executed` / `execution_success` / `execution_cached` 表示节点收尾）。
 * 解析口径只有一份：`~/lib/log/log-cli-json` 的 `parseCliJsonLine`（前缀 + JSON.parse），
 * 这里不另写前缀正则。
 *
 * 纯函数、零 IO、无 React（lib 层边界见规范 18 §18.2）：输入日志行、输出快照，
 * 供测试模型页的进度可视化区（TaskProgressPanel）按渲染时机 memo 调用。
 */

import { isPlainRecord } from "~/lib/is-record";
import { parseCliJsonLine } from "~/lib/log/log-cli-json";
import { toPct } from "~/lib/progress";
import type { TaskLogEntry } from "~/lib/workshop/generation-client";

/** 一个节点的执行状态：running = 已开始（或已有进度帧）未收尾；done = 已完成 / 命中缓存。 */
export type TaskProgressStageStatus = "done" | "running";

export type TaskProgressStage = {
  /** 节点的 class_type（如 `TextGenerateV2`），来自 executing 事件。 */
  classType?: string;
  /** 最新一帧 progress 的已完成数。 */
  completed?: number;
  /** ComfyUI 图内节点 id（如 `23:15`）。 */
  nodeId: string;
  /** 已完成/总量算出的百分比（`toPct` 口径；总量未知 = null = 不确定态）。 */
  pct: number | null;
  status: TaskProgressStageStatus;
  /** 节点显示名（如 `Generate Text`），来自 executing 事件的 title。 */
  title?: string;
  /** 最新一帧 progress 的总量。 */
  total?: number;
};

export type TaskProgressSnapshot = {
  /** 最后一个开始执行的节点（无 executing 事件时为 null）。 */
  currentNodeId: string | null;
  /** 按节点首次出现顺序排列的阶段快照。 */
  stages: Array<TaskProgressStage>;
};

/** 事件对象里节点 id 的取值位置：顶层 `node`，部分事件嵌在 `data.node`。 */
function nodeIdOf(evt: Record<string, unknown>): string | null {
  const direct: unknown = evt.node;
  if (typeof direct === "string" && direct !== "") {
    return direct;
  }
  const data: unknown = evt.data;
  if (isPlainRecord(data)) {
    const nested: unknown = data.node;
    if (typeof nested === "string" && nested !== "") {
      return nested;
    }
  }
  return null;
}

/** 解析一条日志；不是「comfy-cli 原始 JSON 事件」时返回 null。 */
function parseEvent(msg: string): Record<string, unknown> | null {
  const parsed = parseCliJsonLine(msg);
  if (parsed?.tag !== "原始") {
    return null;
  }
  const value: unknown = parsed.value;
  return isPlainRecord(value) ? value : null;
}

/**
 * 把任务日志归并成分节点进度快照。
 *
 * 归并规则（同节点后到的事件覆盖先到的）：
 * - `executing`：ComfyUI 对单个 prompt 是**顺序执行**——新节点开始即意味着
 *   此前开跑过的节点都已收尾，所以先把其它仍标 running 的阶段改成 done
 *   （多数加载器节点只有 executing、没有 executed 事件，不这样会把它们
 *   永远挂在「进行中」），再登记当前节点（title、class_type）并标 running；
 * - `progress`：更新该节点最新 completed/total 与百分比；
 * - `executed` / `execution_success` / `execution_cached`：标 done（缓存跳过也算走到头）。
 * 节点顺序 = 在日志里首次出现的顺序（与 ComfyUI 图的执行顺序一致）。
 */
export function parseTaskLogProgress(logs: ReadonlyArray<TaskLogEntry>): TaskProgressSnapshot {
  const byNode = new Map<string, TaskProgressStage>();
  let currentNodeId: string | null = null;
  for (const entry of logs) {
    const evt = parseEvent(entry.msg);
    if (evt === null) {
      continue;
    }
    const type: unknown = evt.type;
    const nodeId = nodeIdOf(evt);
    if (type === "executing" && nodeId !== null) {
      for (const [id, stage] of byNode) {
        if (id !== nodeId && stage.status === "running") {
          byNode.set(id, { ...stage, status: "done" });
        }
      }
      currentNodeId = nodeId;
      const stage = byNode.get(nodeId) ?? { nodeId, pct: null, status: "running" as const };
      const title: unknown = evt.title;
      const classType: unknown = evt.class_type;
      byNode.set(nodeId, {
        ...stage,
        status: "running",
        ...(typeof title === "string" && title !== "" ? { title } : {}),
        ...(typeof classType === "string" && classType !== "" ? { classType } : {}),
      });
      continue;
    }
    if (type === "progress" && nodeId !== null) {
      const completed: unknown = evt.completed;
      const total: unknown = evt.total;
      if (typeof completed !== "number" || typeof total !== "number" || total <= 0) {
        continue;
      }
      const stage = byNode.get(nodeId) ?? { nodeId, pct: null, status: "running" as const };
      byNode.set(nodeId, {
        ...stage,
        status: stage.status === "done" ? "done" : "running",
        completed,
        total,
        pct: toPct(completed, total),
      });
      continue;
    }
    if (
      (type === "executed" || type === "execution_success" || type === "execution_cached") &&
      nodeId !== null
    ) {
      const stage = byNode.get(nodeId);
      if (stage !== undefined) {
        byNode.set(nodeId, { ...stage, status: "done" });
      }
    }
  }
  return { currentNodeId, stages: [...byNode.values()] };
}
