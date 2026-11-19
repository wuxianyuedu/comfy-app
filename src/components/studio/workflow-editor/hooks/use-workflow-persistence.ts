"use client";

import { useCallback, useEffect } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { Node } from "@xyflow/react";

import { runAsyncAction, type ActionReport } from "~/lib/async-action";
import { errorMessage } from "~/lib/error-message";
import { afterNextPaint } from "~/lib/next-frame";
import type { WorkflowDetail, WorkflowIOParam } from "~/components/studio/workflow-types";
import { NODE_TITLE_H, extractNoteTitle } from "~/components/studio/workflow-utils";
import { MODE_KEY_PREFIX, runtimeNodeId } from "~/lib/workflow/workflow-param-mapping";
import { useToast } from "../../ToastProvider";
import type { WorkflowSaver } from "./use-workflow-save";

/**
 * 带标题栏的卡片（wfNode / wfSubgraph）会在卡片体**上方**多画一条 30px 标题栏，
 * 所以 React Flow 坐标是卡片（标题栏）顶点，磁盘上 ComfyUI 约定是卡片体顶点；
 * 落盘拖拽结果时补上这段偏移，存下的坐标才与其它工具对得上。
 */
const NODE_TITLE_ANCHOR: Record<string, number> = {
  wfNode: NODE_TITLE_H,
  wfSubgraph: NODE_TITLE_H,
};

export type WorkflowPersistenceArgs = {
  detail: WorkflowDetail | null;
  fitToContent: () => void;
  /** 当前视图的宿主链路（顶层为空串，下钻一层 `4`，再下钻 `4:5`）。子图内部的节点 id 是
   *  **裸内部 id**（`1670`），而服务端 `positions` 列存的是**拼接键**（`4:1670`，见
   *  `extractPositions` 的 `${wId}:${iId}`）。不拼前缀，拖拽会写进顶层读不到的裸键，下钻
   *  回来又把它当「原始坐标」盖掉真实位置 —— 重置后回不到原始布局即源于此。 */
  hostNodeId?: string;
  onClose: () => void;
  onSave?: () => void;
  paramMap: Record<string, unknown>;
  /** 重置布局后重新拉当前视图的数据：服务端已删掉本视图的坐标覆盖，
   *  重新取到的就是工作流自带的原始布局。 */
  reloadView?: () => void;
  savePatch: WorkflowSaver;
  setDetail: Dispatch<SetStateAction<WorkflowDetail | null>>;
  setError: Dispatch<SetStateAction<string>>;
  setNodes: Dispatch<SetStateAction<Array<Node>>>;
  setSaving: Dispatch<SetStateAction<boolean>>;
  workflowId: string;
  workflowIO: Record<string, WorkflowIOParam>;
};

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
  /* 「本视图该管哪些键」的唯一判据。`positions` 是混装多套命名空间的平表：顶层节点
   *  裸 id（`4`）、子图内部 `宿主:内部` 拼接键（`4:1670`，嵌套 `4:5:1670`）、边界 pin
   *  导轨 `grp:bpin:inputs|outputs`。只清**本层**：顶层清裸 id，子图视图清 `host:inner`
   *  这一层（`host:inner:deeper` 归更深一层）。口径必须与服务端 `resetPositionsScope`
   *  的删除规则一致，否则本地剔了库里没删（或反之），一刷新又是另一套布局。 */
  const isForeignViewKey = useCallback(
    (key: string) => {
      /* 导轨不属于任何数据节点：顶层视图的导轨是顶层布局的一部分，属于本层
       *  （返回 false = 一并清掉）；子图视图里的导轨属于外层画布，不能顺手
       *  抹掉（返回 true = 保留）。 */
      if (key.startsWith("grp:bpin:")) {
        return hostNodeId !== "";
      }
      if (!hostNodeId) {
        return key.includes(":");
      }
      const prefix = `${hostNodeId}:`;
      if (!key.startsWith(prefix)) {
        return true;
      }
      const inner = key.slice(prefix.length);
      return inner.includes(":");
    },
    [hostNodeId],
  );
  /* 把当前视图的节点位置恢复成工作流自带的原始布局（用户口语里的
   *  「重置位置」）。语义 = 清除本视图所有被改动过的坐标，见下方实现说明。 */
  const resetLayout = useCallback(() => {
    if (!detail) {
      return;
    }
    /* 「重置布局」= 清除本视图所有被改动过的位置，回到自带的原始布局。不能把进入时的
     *  快照写回去：`detail.positions` 是服务端合并**原始坐标**与**用户拖拽覆盖**的结果，
     *  客户端分不清哪个键是覆盖，重写等于把覆盖值当原始值再存一次（重置失效的来源）。
     *  正确做法是让服务端**删掉**本命名空间的键（`resetPositionsScope`），读路径自然只剩
     *  原始坐标；本地旧坐标同样剔除，否则重拉落地前画布还是旧覆盖。 */
    setDetail((prev) => {
      if (!prev) {
        return prev;
      }
      const cur = prev.positions ?? null;
      if (cur === null) {
        return prev;
      }
      const kept: Record<string, [number, number]> = {};
      for (const [key, pos] of Object.entries(cur)) {
        if (isForeignViewKey(key)) {
          kept[key] = pos;
        }
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
              ([key, value]) => value === node.data.nodeId && !key.startsWith(MODE_KEY_PREFIX),
            )?.[0] ?? null,
        },
      })),
    );
  }, [paramMap, setNodes]);

  /* 保存 paramMap + workflowIO（对外输入 / 输出） */
  const handleSave = useCallback(async () => {
    /* `setSaving` 由调用处持有（顶部栏据此禁用按钮），复位绑在 `finally`
     * 上 —— 收口前写在动作之后，动作里任意一行抛错就永远停在「保存中」。 */
    setSaving(true);
    try {
      await runAsyncAction(
        async () => {
          await savePatch.mutateAsync({
            id: workflowId,
            paramMap,
            workflowIO,
          });
          onSave?.();
        },
        {
          /* 成功 / 失败走**两条不同的通道**：成功是 toast（保存后停留在当前
           * 工作流界面，不再 onClose 退出 —— 用户通常还要继续调整），失败是
           * **行内错误块**（保存失败时往往要重试或去改配置，需要一个留着不走的
           * 出口）。通道差异由 `report` 表达，文案归一由出口负责。 */
          report: ((kind, detail) => {
            if (kind === "ok") {
              toast.success("已保存", "画布修改与 IO 配置已落库，可继续编辑");
            } else {
              setError(detail);
            }
          }) satisfies ActionReport,
          failureText: "保存失败",
        },
      );
    } finally {
      setSaving(false);
    }
  }, [workflowId, paramMap, workflowIO, onSave, savePatch, setError, setSaving, toast]);

  /* 用户拖完节点后落盘位置：备注（`note:<id>`）经 `notes` PATCH 写回 rawJson 的 pos 并
   *  镜像本地 detail（免得下次渲染回弹）；真实图节点经 `positions` PATCH 写入并镜像；
   *  边界钉住的分组（`grp:bpin:inputs|outputs`）把分组矩形写进 `positions`，子节点带
   *  parentId + extent:"parent" 随分组移动故只落父级。单个 `bpin:*` 不可拖（布局阶段
   *  draggable:false），分支永不触发。写盘 fire-and-forget，**不得**触发 detail 重拉否则画布闪一下；锚点换算见下方。 */
  const reportPositionSaveFailure = useCallback(
    (err: unknown) => {
      console.error("[workflow-persistence] failed to persist node position", err);
      /* 失败路径的文案统一走 `errorMessage`（`~/lib/async-action` 的口径）——
       * 收口前这里是自己拼的 `err instanceof Error ? err.message : "请重试"`，
       * 网络层原文没有经过 `errorMessage` 的翻译。 */
      toast.error("位置保存失败", errorMessage(err, "请重试"));
    },
    [toast],
  );

  const onNodeDragStop = useCallback(
    (_event: unknown, node: Node) => {
      /* `detail` 在 loading → ready 的过渡期可能是 null
       *（例如用户在加载中关掉了编辑器）；那种情况下没地方
       * 写新位置。静默返回 —— 下次打开时画布会带着
       * 已落盘的状态重新挂载。 */
      if (!detail) {
        return;
      }
      const x = Math.round(node.position.x);
      /* 锚点反转：wfNode / wfSubgraph 的 `position.y` 是**卡片**（标题栏）顶点，卡片体在
       *  其下 `NODE_TITLE_H`(30px) 处；磁盘 `positions[id]` 必须保持 ComfyUI 的卡片体顶点
       *  约定，故落盘前**加上** NODE_TITLE_H（bodyTop = cardTop + 30）。无标题备注、wfGroup
       *  与 wfIoPort 没有标题栏，`position` 本就等于 ComfyUI 左上角；带标题的备注见下一分支。 */
      const back =
        node.type !== undefined && node.type !== "" ? (NODE_TITLE_ANCHOR[node.type] ?? 0) : 0;
      const y = Math.round(node.position.y + back);
      if (node.id.startsWith("note:")) {
        const noteId = node.id.replace(/^note:/, "");
        /* 与 wfNode / wfSubgraph 同一套锚点约定：带标题备注的 `position.y` 是**卡片**（标题栏）
         *  顶点，卡片体在其下 NODE_TITLE_H 处；磁盘 `pos` 保持 ComfyUI 卡片体顶点约定，故
         *  落盘前**加上** NODE_TITLE_H。无标题备注无标题栏，无需反转。 */
        const noteMeta = (detail.notes ?? []).find((nn) => String(nn.id) === noteId);
        const noteHasTitle = noteMeta ? !!extractNoteTitle(noteMeta.text, noteMeta.title) : false;
        const noteY = Math.round(node.position.y + (noteHasTitle ? NODE_TITLE_H : 0));
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
        /* 图节点拖拽统一写回 detail.positions（覆盖 ComfyUI 原始布局）。子图视图的节点 id 是
         *  **裸内部 id**，`positions` 列存 `宿主:内部` 拼接键（`runtimeNodeId` 即该约定的实现，
         *  预览 / 运行链路同用）。不拼前缀会各写各的键：子图拖拽落到 `1670`、顶层只认 `4:1670`，
         *  两套布局互不可见，下钻回来裸键还会被当成「已保存坐标」盖掉真实位置。 */
        const nodeId = runtimeNodeId({ nodeId: node.id, hostNodeId });
        setDetail((prev) =>
          prev
            ? {
                ...prev,
                positions: { ...prev.positions, [nodeId]: [x, y] },
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
    [detail, setDetail, workflowId, savePatch, hostNodeId, reportPositionSaveFailure],
  );

  return { resetLayout, handleSave, onNodeDragStop };
}
