"use client";

import { useCallback, useEffect } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { Node } from "@xyflow/react";
import type {
  WorkflowDetail,
  WorkflowIOParam,
} from "@/components/studio/workflow-types";
import {
  NODE_TITLE_H,
  extractNoteTitle,
} from "@/components/studio/workflow-utils";
import { MODE_KEY_PREFIX, runtimeNodeId } from "@/lib/workflow-param-mapping";
import { useToast } from "../../ToastProvider";
import type { WorkflowSaver } from "./use-workflow-save";

/**
 * Cards with a title bar (wfNode / wfSubgraph) paint a 30px bar ABOVE their
 * body, so React Flow's node position is the card (title-bar) top while the
 * on-disk ComfyUI convention keeps the body top. We add this offset when
 * persisting a drag so the stored coordinate matches other tools.
 */
const NODE_TITLE_ANCHOR: Record<string, number> = {
  wfNode: NODE_TITLE_H,
  wfSubgraph: NODE_TITLE_H,
};

/**
 * Run `cb` after the browser has painted, so the optimistic `setDetail` from
 * resetLayout has committed and React Flow has laid out the canvas before we
 * fit the view. Two frames: one for the React commit, one for the layout pass.
 */
function afterNextPaint(cb: () => void): void {
  requestAnimationFrame(() => requestAnimationFrame(cb));
}

export interface WorkflowPersistenceArgs {
  workflowId: string;
  detail: WorkflowDetail | null;
  setDetail: Dispatch<SetStateAction<WorkflowDetail | null>>;
  setNodes: Dispatch<SetStateAction<Node[]>>;
  paramMap: Record<string, unknown>;
  workflowIO: Record<string, WorkflowIOParam>;
  fitToContent: () => void;
  savePatch: WorkflowSaver;
  onSave?: () => void;
  onClose: () => void;
  setSaving: Dispatch<SetStateAction<boolean>>;
  setError: Dispatch<SetStateAction<string>>;
  /** 重置布局后重新拉当前视图的数据：服务端已删掉本视图的坐标覆盖，
   *  重新取到的就是工作流自带的原始布局。 */
  reloadView?: () => void;
  /** 当前视图的宿主链路（顶层为空串，下钻一层是 `4`，再下钻是 `4:5`）。
   *  子图内部的节点 id 是**裸内部 id**（`1670`），而服务端 `positions` 列里
   *  同一批节点存的是**拼接键**（`4:1670`，见 `extractPositions` 里
   *  `${wId}:${iId}` 的写法）。两者不是同一套键：不拼上前缀，
   *  子图里的拖拽会写进一个顶层永远读不到的裸键、下钻回来时又拿它当
   *  「原始坐标」把真实位置盖掉 —— 这正是「改过位置的节点重置后回不到原始
   *  布局、再改一次却回归到一个错误位置」的来源。 */
  hostNodeId?: string;
}

/**
 * 工作流编辑器的布局快照 / 重置 / 保存 / 拖拽落盘逻辑。
 */
export function useWorkflowPersistence({
  workflowId,
  detail,
  setDetail,
  setNodes,
  paramMap,
  workflowIO,
  fitToContent,
  savePatch,
  onSave,
  setSaving,
  setError,
  reloadView,
  hostNodeId = "",
}: WorkflowPersistenceArgs) {
  const toast = useToast();
  /* 「本视图该管哪些键」的唯一判据。
   *
   * `positions` 是一张混装多套 id 命名空间的平表：
   *   · 顶层节点      → 裸 id（`4`）
   *   · 子图内部节点  → `宿主:内部` 拼接键（`4:1670`；嵌套是 `4:5:1670`）
   *   · 边界 pin 导轨 → `grp:bpin:inputs|outputs`
   * 重置布局只该清掉**本层**的键：顶层视图清裸 id（子图的 `host:inner` 属于
   * 下钻视图），子图视图清 `host:inner` 这一层（`host:inner:deeper` 属于更深
   * 一层）。判断口径与服务端 `resetPositionsScope` 的删除规则必须一致，否则
   * 本地剔了、库里没删（或反过来），一刷新又是另一个布局。 */
  const isForeignViewKey = useCallback(
    (key: string) => {
      /* 导轨不属于任何数据节点：顶层视图的导轨是顶层布局的一部分，属于本层
       *  （返回 false = 一并清掉）；子图视图里的导轨属于外层画布，不能顺手
       *  抹掉（返回 true = 保留）。 */
      if (key.startsWith("grp:bpin:")) return hostNodeId !== "";
      if (!hostNodeId) return key.includes(":");
      const prefix = `${hostNodeId}:`;
      if (!key.startsWith(prefix)) return true;
      const inner = key.slice(prefix.length);
      return inner.includes(":");
    },
    [hostNodeId],
  );
  /* 把当前视图的节点位置恢复成工作流自带的原始布局（用户口语里的
   *  「重置位置」）。语义 = 清除本视图所有被改动过的坐标，见下方实现说明。 */
  const resetLayout = useCallback(() => {
    if (!detail) return;
    /* 「重置布局」= 清除本视图所有被改动过的位置，回到工作流自带的原始布局。
     *
     * 不能靠「把进入时的快照写回去」：客户端拿到的 `detail.positions` 是
     * 服务端把**原始坐标**与**用户拖拽覆盖**合并后的结果，客户端分不清哪个
     * 键是覆盖。照着重写一遍等于把覆盖值当原始值再存一次 —— 那正是「重置后
     * 回不到原始布局」「再改一次反而回归到一个错误位置」的来源：重置写的
     * 恰恰就是它要清的那份数据。
     *
     * 正确做法是让服务端**删掉**本命名空间的坐标键（`resetPositionsScope`）：
     * 读路径在覆盖消失后自然只剩原始坐标，语义与用户理解的「清除更改过的
     * 位置」一致。本地的旧坐标同样要剔除，否则在重新拉取落到之前，画布还是
     * 旧的覆盖值。 */
    setDetail((prev) => {
      if (!prev) return prev;
      const cur = prev.positions ?? null;
      if (cur === null) return prev;
      const kept: Record<string, [number, number]> = {};
      for (const [key, pos] of Object.entries(cur)) {
        if (isForeignViewKey(key)) kept[key] = pos;
      }
      return { ...prev, positions: Object.keys(kept).length > 0 ? kept : null };
    });
    savePatch.mutate({
      id: workflowId,
      /* 空串 = 顶层视图；子图视图传宿主链（`4` / `4:5`）。服务端据此只清
       *  本层的键，别的命名空间与别的层级原样保留。 */
      resetPositionsScope: hostNodeId,
    });
    /* 重新拉当前视图：服务端的覆盖已经删掉，这一次拿到的是真正的原始布局
     * （子图视图的原始坐标来自 `definitions.subgraphs[uid].nodes[].pos`）。
     * 不重拉也能看，但本地剔除只能丢掉已知的覆盖键；重拉才是一次干净的
     * 对齐，也顺带把服务端缓存里那份带覆盖的结果换掉。 */
    if (reloadView) {
      reloadView();
    } else {
      afterNextPaint(fitToContent);
    }
  }, [
    detail,
    setDetail,
    workflowId,
    fitToContent,
    savePatch,
    hostNodeId,
    reloadView,
    isForeignViewKey,
  ]);

  /* Re-sync nodes when paramMap changes (update assignedRole badges). 取角色时
   *  跳过 `mode:` 前缀的按模式连线表 —— 它的值不是节点 id，命中会把整张模式
   *  表当成某个节点的角色名。 */
  useEffect(() => {
    setNodes((nds) =>
      nds.map((node) => ({
        ...node,
        data: {
          ...node.data,
          assignedRole:
            Object.entries(paramMap).find(
              ([key, value]) =>
                value === node.data.nodeId && !key.startsWith(MODE_KEY_PREFIX),
            )?.[0] ?? null,
        },
      })),
    );
  }, [paramMap, setNodes]);

  /* Save paramMap + workflowIO (exposed inputs/outputs) */
  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      await savePatch.mutateAsync({
        id: workflowId,
        paramMap,
        workflowIO,
      });
      onSave?.();
      /* 保存后停留在当前工作流界面（不再 onClose 退出）——用户保存 IO /
       * 布局后通常还要继续调整；成功与否由 toast 反馈。 */
      toast.success("已保存", "画布修改与 IO 配置已落库，可继续编辑");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }, [
    workflowId,
    paramMap,
    workflowIO,
    onSave,
    savePatch,
    setError,
    setSaving,
    toast,
  ]);

  /* Persist a node's position after the user finishes dragging it.
   *  - Note nodes (`note:<id>`) → write back into rawJson.nodes[i].pos via
   *    the `notes` PATCH field, and reflect the new coord in local `detail`
   *    so the canvas stays consistent (no snap-back on the next render).
   *  - Real graph nodes → write into the `positions` column via the
   *    `positions` PATCH field, likewise mirrored into local `detail`.
   *  - Boundary-pin GROUPS (`grp:bpin:inputs|outputs`)
   *    → write the group rect into `positions` so the rail stays where the
   *    user dropped it after reload.  The children carry parentId +
   *    extent:"parent" and move automatically with the group, so we don't
   *    persist them individually — only the parent.
   *  - Individual `bpin:*` nodes are NOT draggable (`draggable: false` in
   *    the layout pass) so this branch never fires for them; if a future
   *    change makes them draggable we'd persist their position the same
   *    way as a real graph node.
   *  The write is fire-and-forget: it must NOT trigger a detail re-fetch, so
   *  the canvas never re-mounts or flashes. */
  const reportPositionSaveFailure = useCallback(
    (err: unknown) => {
      console.error(
        "[workflow-persistence] failed to persist node position",
        err,
      );
      toast.error(
        "位置保存失败",
        err instanceof Error ? err.message : "请重试",
      );
    },
    [toast],
  );

  const onNodeDragStop = useCallback(
    (_event: unknown, node: Node) => {
      /* `detail` may be null during the loading → ready transition
       * (e.g. user closes the editor mid-load); if so we have nowhere
       * to persist the new position.  Bail silently — the canvas
       * re-mounts with the persisted state on the next open. */
      if (!detail) return;
      const x = Math.round(node.position.x);
      /* Anchor inversion: wfNode / wfSubgraph cards paint a
       *  30 px title bar ABOVE their body, so the React Flow `position.y`
       *  is the CARD (title-bar) top, and the body sits `NODE_TITLE_H`
       *  below it.  The on-disk `positions[id]` must keep the ComfyUI
       *  body-top convention (what the user/other tools expect), so we
       *  ADD NODE_TITLE_H before persisting: bodyTop = cardTop + 30.
       *  Untitled notes, wfGroup and wfIoPort don't carry a title bar,
       *  so their `position` already equals the ComfyUI top-left. */
      const back = node.type ? (NODE_TITLE_ANCHOR[node.type] ?? 0) : 0;
      const y = Math.round(node.position.y + back);
      if (node.id.startsWith("note:")) {
        const noteId = node.id.replace(/^note:/, "");
        /* Same anchor convention as the wfNode / wfSubgraph branch: a
         *  titled note's React Flow `position.y` is its CARD top
         *  (title-bar top), while the body sits NODE_TITLE_H below.  The
         *  on-disk `pos` keeps the ComfyUI body-top convention, so we
         *  ADD NODE_TITLE_H before persisting.  Untitled notes need no
         *  inversion because their React Flow box has no title bar. */
        const noteMeta = (detail.notes ?? []).find(
          (nn) => String(nn.id) === noteId,
        );
        const noteHasTitle = noteMeta
          ? !!extractNoteTitle(noteMeta.text, noteMeta.title)
          : false;
        const noteY = Math.round(
          node.position.y + (noteHasTitle ? NODE_TITLE_H : 0),
        );
        setDetail((prev) =>
          prev
            ? {
                ...prev,
                notes: (prev.notes ?? []).map((note) =>
                  note.id === noteId ? { ...note, pos: [x, noteY] } : note,
                ),
              }
            : prev,
        );
        savePatch.mutate(
          {
            id: workflowId,
            notes: [{ id: noteId, pos: [x, noteY] }],
          },
          { onError: reportPositionSaveFailure },
        );
      } else {
        /* 图节点拖拽统一
         *  写回 detail.positions（覆盖 ComfyUI 原始布局）。
         *
         *  子图视图下的节点 id 是**裸内部 id**，而 `positions` 列存的是
         *  `宿主:内部` 拼接键（`runtimeNodeId` 就是这条约定的实现，预览/运行
         *  链路也用它）。不拼前缀就会出现两个各写各的键：子图里的拖拽落到
         *  `1670`、顶层链路只认 `4:1670`，两边的布局互相看不见 —— 下钻回来
         *  时那个裸键还会被当成「已保存坐标」把真正的原始位置盖掉。 */
        const nodeId = runtimeNodeId({ nodeId: node.id, hostNodeId });
        setDetail((prev) =>
          prev
            ? {
                ...prev,
                positions: { ...(prev.positions ?? {}), [nodeId]: [x, y] },
              }
            : prev,
        );
        /* 一律走 `merge: true` 的单键合并：`positions` 是一张混装多套
         *  id 命名空间（顶层裸 id / 子图拼接键 / `grp:bpin:*` 导轨）的平表，
         *  顶层默认的 REPLACE 会把其它命名空间的坐标整片清掉。 */
        savePatch.mutate(
          {
            id: workflowId,
            positions: { [nodeId]: [x, y] },
            mergePositions: true,
          },
          { onError: reportPositionSaveFailure },
        );
      }
    },
    [
      detail,
      setDetail,
      workflowId,
      savePatch,
      hostNodeId,
      reportPositionSaveFailure,
    ],
  );

  return { resetLayout, handleSave, onNodeDragStop };
}
