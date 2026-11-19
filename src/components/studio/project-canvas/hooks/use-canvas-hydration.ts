"use client";

/** 画布挂载水合的编排（#4235 自 ProjectCanvas 抽出，便于脱离 ReactFlow 渲染面单测）。
 *
 *  钉住的行为：
 *  · 仅首挂载跑一次；落库结果（项目 id / 名称 / 节点 / 连线 / 选中 / 进度 / loading
 *    复位）全部收进 stale 守卫——卸载后不落地（§08 8.9③ 发起时快照纪律）。
 *  · 中途任何一步抛错（畸形 pendingWorkflow / 旧版本脏数据 / 服务端对账失败）必须
 *    把「加载中」复位并给用户可见出口（toast + console 留痕）——原先的
 *    `.catch(() => {})` 会把画布永久卡在加载中（§08 8.7 / §10.1）。
 *
 *  `materializeProductionShots` 与它的两个收窄助手（`isShot` / `shotIdOfNode`）随
 *  编排一起搬进来：它们只服务这条水合链（原文件里无第二个消费方）。 */

import { useEffect, useState } from "react";
import type { Edge } from "@xyflow/react";
import { errorText } from "~/lib/error-message";
import { isPlainRecord } from "~/lib/is-record";
import { placeCanvasNode } from "~/lib/project-canvas/canvas-helpers";
import { defaultData, type CanvasNodeType } from "~/lib/project-canvas/canvas-types";
import {
  createDraftProject,
  getActiveId,
  getProject,
  hydrateFromServer,
  listProjects,
  reapAllEmptyDrafts,
  setActive,
  type CanvasProject,
} from "~/lib/project-canvas/canvas-store";
import { applyShotPatches, planShotSync, shotToNodePatch } from "~/lib/production/sync";
import { fetchProduction, type ProductionData } from "~/lib/production/production-client";
import { normalizeProductionProgress, type ProductionProgress } from "~/lib/production/progress";
import { beginStaleRun } from "~/lib/stale-run";
import type { Shot } from "~/lib/workshop/types";
import { useToast } from "~/components/studio/ToastProvider";

/** 落点函数的形状与 placeCanvasNode 的入参同源（不另立一份）。 */
type PlaceFlowFn = Parameters<typeof placeCanvasNode>[0]["flow"]["screenToFlowPosition"];

export type UseCanvasHydrationDeps = {
  onConsumePending?: () => void;
  onConsumeSeed?: () => void;
  /** 设置后（来自工作区「工作流库 → 使用」动作）画布会为这条工作流往当前
   *  打开的项目里放一个 `kind="workflow"` 节点。 */
  pendingWorkflow?: { id: string; name: string; taskType: string } | null;
  requestFitView: () => void;
  screenToFlowPosition: PlaceFlowFn;
  seedNew?: boolean;
  setEdges: (edges: Edge[]) => void;
  setNodes: (nodes: Array<CanvasNodeType>) => void;
  setProgress: (progress: ProductionProgress | null) => void;
  setProjectId: (id: string | null) => void;
  setProjectName: (name: string) => void;
};

/** 节点上的镜头 id（非镜头节点没有 `data.shotId`）。 */
function shotIdOfNode(n: CanvasNodeType): string | undefined {
  /* SAFETY: 类型断言已复核 */
  const data = n.data as { shotId?: string } | undefined;
  return data?.shotId;
}

/** `production.shots`（`unknown[]`）逐项收窄：缺必填字段 / 类型不符的记录不投影。 */
function isShot(value: unknown): value is Shot {
  if (!isPlainRecord(value)) {
    return false;
  }
  return (
    typeof value.id === "string" &&
    value.id !== "" &&
    typeof value.index === "number" &&
    Number.isInteger(value.index) &&
    typeof value.sceneId === "string" &&
    typeof value.sceneHeading === "string" &&
    typeof value.shotType === "string" &&
    typeof value.description === "string" &&
    Array.isArray(value.characterIds) &&
    value.characterIds.every((id) => typeof id === "string") &&
    typeof value.status === "string" &&
    typeof value.prompt === "string" &&
    typeof value.negativePrompt === "string" &&
    isPlainRecord(value.params)
  );
}

/** 把 production.shots 物化 / 合并进画布节点（Phase 3c-2a，幂等）。
 *  已有镜头节点（data.shotId 命中）合并补丁，缺失的新建；非镜头节点原样保留。 */
function materializeProductionShots(
  nodes: Array<CanvasNodeType>,
  prod: ProductionData | null,
  screenToFlowPosition: PlaceFlowFn,
): Array<CanvasNodeType> {
  const shots = prod && Array.isArray(prod.shots) ? prod.shots.filter(isShot) : [];
  if (shots.length === 0) {
    return nodes;
  }
  const existingShotIds = new Set(
    nodes.map(shotIdOfNode).filter((id): id is string => Boolean(id)),
  );
  const { patches, newShotIds } = planShotSync(shots, existingShotIds);
  let result = applyShotPatches(nodes, patches);
  const byId = new Map(shots.map((s) => [s.id, s]));
  for (const sid of newShotIds) {
    const shot = byId.get(sid);
    if (!shot) {
      continue;
    }
    result = placeCanvasNode({
      nodes: result,
      flow: { screenToFlowPosition },
      data: { ...defaultData("image"), ...shotToNodePatch(shot) },
    });
  }
  return result;
}

/** 挂载水合：返回「是否仍在加载」（画布据此渲染骨架）。 */
export function useCanvasHydration(deps: UseCanvasHydrationDeps): boolean {
  const {
    onConsumePending,
    onConsumeSeed,
    pendingWorkflow,
    requestFitView,
    screenToFlowPosition,
    seedNew,
    setEdges,
    setNodes,
    setProgress,
    setProjectId,
    setProjectName,
  } = deps;
  const [hydrating, setHydrating] = useState(true);
  const toast = useToast();

  useEffect(() => {
    /* StrictMode 双执行说明（#4541 取证）：dev 下 effect 会挂载即跑两轮 ——
     * 第一轮的守卫被清理作废、第二轮重新起守卫。此前的 `loadedRef` 闩锁让
     * 第二轮**直接退场**，而第一轮的写入又被清理作废 ⇒ `setHydrating(false)`
     * 永不落地，项目画布在 dev 下永久卡「加载中」。水合本身是幂等读
     * （localStorage + 服务端对账 + production 拉取），重放一轮只多两次
     * dev-only 请求，换来两轮里**必有一轮活守卫**能把结果提交进界面。 */
    const guard = beginStaleRun();
    /* 卸载守卫 + 失败收口（#4235）：水合中途任何一步抛错都不许被吞——
     * 全部 setState 收进 stale 守卫（卸载后不落地），失败时复位 loading +
     * toast 留一条可行动的出口（§08 8.7 / §10.1），console 进 LogProvider 留痕。 */
    void (async () => {
      try {
        // 在读取当前项目**之前**先把服务端项目对账进 localStorage，
        // 这样换端口（3100↔3102）/ 换设备都不会丢掉
        // 已落库的画布数据。
        await hydrateFromServer();
        reapAllEmptyDrafts(); // one-shot cleanup of pre-fix pollution
        let proj: CanvasProject | null = null;
        if (seedNew === true) {
          proj = createDraftProject();
        } else {
          const activeId = getActiveId();
          if (activeId !== null && activeId !== "") {
            proj = getProject(activeId);
          }
          proj ??= listProjects()[0] ?? null;
          proj ??= createDraftProject();
        }

        /* 从工作流库「使用」跳转回来时，pendingWorkflow 在挂载时就
         * 已传入。project 加载 effect 会覆盖 nodes，因此必须在这里把新节点合并进
         * baseNodes，否则原来的独立 effect 临时放置的节点会被 setNodes(baseNodes)
         * 覆盖掉，导致用户只看到已有节点被聚焦。 */
        const baseNodes = proj.nodes ?? [];
        let nextNodes = baseNodes;
        if (pendingWorkflow) {
          /* 落点四步走唯一出口（规范 16 §16.2.4.38）：这里没有落点信息，
           * 由出口的 `viewportCenter()` 给视口中心。 */
          nextNodes = placeCanvasNode({
            nodes: baseNodes,
            flow: { screenToFlowPosition },
            data: {
              ...defaultData("workflow"),
              workflowId: pendingWorkflow.id,
              workflowName: pendingWorkflow.name,
              workflowTaskType: pendingWorkflow.taskType,
            },
          });
          onConsumePending?.();
        }
        const prod = await fetchProduction(proj.id);
        nextNodes = materializeProductionShots(nextNodes, prod, screenToFlowPosition);
        /* 全部落库结果的落地收进一处：卸载后不写（发起时快照纪律，§08 8.9③）。 */
        guard.commit(() => {
          setProjectId(proj.id);
          setProjectName(proj.name);
          /* 顺带取回完成状态：与工坊共读同一份 production.progress（Phase 4b / §7）。 */
          setProgress(prod ? normalizeProductionProgress(prod.progress) : null);
          setNodes(nextNodes);
          setEdges(proj.edges ?? []);
          setActive(proj.id);
          setHydrating(false);
        });
        // fit after nodes are applied（双 rAF，等 ReactFlow 完成布局）
        requestFitView();
        onConsumeSeed?.();
      } catch (error) {
        /* 失败也要把「加载中」复位，否则用户面对的是一块永久空画布；
         * 文案给可行动出口（刷新重试），原因走 errorText 翻译网络层原文。 */
        guard.commit(() => {
          setHydrating(false);
        });
        console.error("[canvas] 画布水合失败", error);
        toast.error(errorText(error, "画布加载失败，请刷新重试"));
      }
    })();
    return () => {
      guard.dispose();
    };
    /* 仅首挂载执行一次：这是「打开画布时把落库内容灌进来」的初始化，依赖里的
     * 每个值都在挂载那一刻读一次即可——之后的变化由各自的独立 effect 接管。 */
    // oxlint-disable-next-line react/exhaustive-deps
  }, []);

  return hydrating;
}
