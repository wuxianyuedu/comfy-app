// ── 生产模型同步 reducer（Phase 3a：纯函数，无 React、无 IO）──────────────
//
// 画布节点 ↔ 工坊镜头（Shot）的 shot 级双向映射。这是「工坊产出什么、画布就出现
// 什么」的换算内核：两侧都经这里搬运，视图不各写一份（§12.12 去重、§17 逻辑收口）。
//
// 单一写入者（ADR §6.4）：
//   · 镜头「编辑面」（prompt / negative）—— 画布节点可改，回写进 Shot；
//   · 镜头「生成态」（status / taskId / 产物 url）—— 由工坊/任务侧写，投影到节点；
// 两侧写的是同一批 Shot 的不同字段，不互相覆盖。
//
// 本文件只做「值怎么换算/合并」，不碰存储与渲染；接线（工坊写入、画布物化）在
// Phase 3b/3c。

import type { Shot } from "~/lib/workshop/types";
import type { StrictCanvasNodeData } from "~/lib/project-canvas/canvas-types";

/** 两侧状态词表不同：Shot 有 queued/stale，画布节点只有 idle/running/done/error。
 *  收口成一处映射，避免各调用点各猜一次。 */
export function shotStatusToNodeStatus(
  status: Shot["status"],
): StrictCanvasNodeData["status"] {
  switch (status) {
    case "running":
    case "queued":
      return "running";
    case "done":
      return "done";
    case "failed":
      return "error";
    case "stale":
    case "idle":
    default:
      return "idle";
  }
}

/** 一个 Shot 投影到画布节点 data 上的字段补丁（写进带同一 shotId 的节点）。 */
export interface ShotNodePatch {
  shotId: string;
  kind: "image" | "video";
  prompt: string;
  negative: string;
  status: StrictCanvasNodeData["status"];
  taskId?: string;
  resultPath?: string;
}

/** Shot → 节点补丁。当前阶段镜头图（imageUrl）投影为 image 节点的 resultPath；
 *  视频片段（clipUrl）在 Phase 3c 接入视频节点，这里先只映镜头图。 */
export function shotToNodePatch(shot: Shot): ShotNodePatch {
  return {
    shotId: shot.id,
    kind: "image",
    prompt: shot.prompt,
    negative: shot.negativePrompt,
    status: shotStatusToNodeStatus(shot.status),
    taskId: shot.taskId,
    resultPath: shot.imageUrl,
  };
}

/** 画布节点上对某镜头的「编辑面」改动，回写成 Shot 的部分补丁。
 *  只回写 prompt / negative，不回写生成态（那是任务侧的写入面）。 */
export interface ShotEditPatch {
  prompt: string;
  negativePrompt: string;
}

export function nodeEditToShot(patch: {
  prompt: string;
  negative: string;
}): ShotEditPatch {
  return { prompt: patch.prompt, negativePrompt: patch.negative };
}

/** 把一批 Shot 同步进「已有节点」的规划：
 *   · 每个 Shot 产出一条节点补丁（供 patch 已存在的同 shotId 节点）；
 *   · 现有节点里没有对应 shotId 的，列为待新建。
 *  非镜头节点（无 shotId）不在输入集合里，天然不受影响。纯函数，便于单测。 */
export function planShotSync(
  shots: Shot[],
  existingShotIds: ReadonlySet<string>,
): { patches: ShotNodePatch[]; newShotIds: string[] } {
  const patches: ShotNodePatch[] = [];
  const newShotIds: string[] = [];
  for (const shot of shots) {
    patches.push(shotToNodePatch(shot));
    if (!existingShotIds.has(shot.id)) newShotIds.push(shot.id);
  }
  return { patches, newShotIds };
}

/** 带 shotId 锚的最小节点形状（画布节点结构上满足；避免耦合 ReactFlow 完整类型）。 */
export interface ShotAnchoredNode {
  data?: { shotId?: string } & Record<string, unknown>;
}

/** 把 shot 补丁按 `data.shotId` 合并到已有节点：命中则合并补丁，非镜头节点或无匹配
 *  原样返回。纯函数，供画布物化镜头节点用（Phase 3c）——新建节点需要视口坐标，由
 *  调用方（画布）经 `placeCanvasNode` 处理，这里只负责「已有节点的回写合并」。 */
export function applyShotPatches<T extends ShotAnchoredNode>(
  nodes: T[],
  patches: readonly ShotNodePatch[],
): T[] {
  const byShot = new Map(patches.map((patch) => [patch.shotId, patch]));
  return nodes.map((node) => {
    const shotId = node.data?.shotId;
    if (!shotId) return node;
    const patch = byShot.get(shotId);
    if (!patch) return node;
    return { ...node, data: { ...node.data, ...patch } };
  });
}

/* ── 画布 → Shot 生成态回写（Phase 3c-2b）────────────────────────────────
 *  画布上对某镜头节点触发生图，产出的生成态（status / taskId / 结果 url）回写进
 *  对应 Shot，让工坊反映「画布上跑的镜头」。与 shotStatusToNodeStatus 对偶的反向
 *  映射收在一处。单一写入者（ADR §6.4）：这里只写生成态字段，绝不碰编辑面
 *  （prompt/negative 是工坊写入面）。 */

/** 画布节点生成态词表 → Shot.status 反向映射（与 shotStatusToNodeStatus 对偶）。
 *  节点词表更窄（idle/running/done/error），逐一对回：done→done、error→failed。 */
export function nodeStatusToShotStatus(
  status: StrictCanvasNodeData["status"],
): Shot["status"] {
  switch (status) {
    case "running":
      return "running";
    case "done":
      return "done";
    case "error":
      return "failed";
    case "idle":
    default:
      return "idle";
  }
}

/** 一次镜头生成态回写的补丁（只覆盖生成态字段，不含编辑面）。 */
export interface ShotGenerationPatch {
  status: Shot["status"];
  taskId?: string;
  imageUrl?: string;
}

/** 从画布镜头节点的 data 提炼生成态补丁。节点 resultPath ↔ Shot imageUrl（与
 *  shotToNodePatch 同口径）：仅 done 且有结果时才写 url，避免运行中清空已有 url。 */
export function nodeGenToShot(node: {
  status: StrictCanvasNodeData["status"];
  taskId?: string;
  resultPath?: string;
}): ShotGenerationPatch {
  const patch: ShotGenerationPatch = {
    status: nodeStatusToShotStatus(node.status),
  };
  if (node.taskId !== undefined) patch.taskId = node.taskId;
  if (node.status === "done" && node.resultPath)
    patch.imageUrl = node.resultPath;
  return patch;
}

/** 把某镜头的生成态补丁合并进 shots（按 id 命中，不可变返回新数组）。
 *  无命中 → 原样返回入参引用（调用方可据此判断「没有对应镜头、无需落库」）。 */
export function applyShotGeneration(
  shots: Shot[],
  shotId: string,
  patch: ShotGenerationPatch,
): Shot[] {
  let hit = false;
  const next = shots.map((shot) => {
    if (shot.id !== shotId) return shot;
    hit = true;
    return { ...shot, ...patch };
  });
  return hit ? next : shots;
}
