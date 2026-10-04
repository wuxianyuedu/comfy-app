"use client";
/* ════════════════════════════════════════════════════════════════════════
 *  IOEditContext.tsx — io 风格 API 的单一出口 + 可复用消费型组件
 * ────────────────────────────────────────────────────────────────────────
 *  状态与动作住在 `workflow-editor/WorkflowStores.tsx`（createStore 工厂 +
 *  WFStoresContext 载体），节点 JSON 弹层也在同一支 store 里（`useNodeJsonViewer`）。
 *  本文件只保留可复用的消费型组件 IoCheckbox / NodeIdChip（经 store hook 读取），
 *  并把 store 的 hook / 选择器 / Provider 再导出一次，让 WorkflowNode /
 *  WorkflowSubgraphNode 等消费方从同一文件取「io 风格」API。
 *
 *  文件名保留 `IOEditContext` 是有意的：它是 store 状态迁移**之前**的旧名字，
 *  而 `useIOEditContext()` 这个组合 hook 至今是画布内多处的入口 —— 改名会牵动
 *  一片调用点，收益只是「名字更贴现状」。真正的单一出口是上方那句再导出。
 * ════════════════════════════════════════════════════════════════════════ */
import React from "react";
import type { IoRef } from "../workflow-types";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import {
  WFStoresProvider,
  useIOEditStore,
  selectWorkflowIO,
  useRgthreeGroups,
  useNodeJsonViewer,
  selectIoEditMode,
  selectIoPreviewOpen,
  createIOEditStore,
  createRgthreeGroupsStore,
  createNodeJsonViewerStore,
} from "../workflow-editor/WorkflowStores";
import { Hint } from "~/components/ui/hint";

/* ── 再导出：画布消费方统一从本文件取以下符号（store 的实现不在本文件） ── */
export {
  WFStoresProvider,
  useIOEditStore,
  selectWorkflowIO,
  selectIoEditMode,
  selectIoPreviewOpen,
  useRgthreeGroups,
  useNodeJsonViewer,
  createIOEditStore,
  createRgthreeGroupsStore,
  createNodeJsonViewerStore,
};

/** 画布节点拿到的 io 值对象 —— 由 store 组合成一个对象，调用点一次订阅即可。
 *  比逐个订阅 store 更省心，代价是这 7 个字段任一变化都会重渲（它们本就同属
 *  一次 IO 编辑动作，实测不构成热点）。 */
export function useIOEditContext() {
  const workflowIO = useIOEditStore(selectWorkflowIO);
  const ioEditMode = useIOEditStore(selectIoEditMode);
  const ioPreviewOpen = useIOEditStore(selectIoPreviewOpen);
  const toggleIO = useIOEditStore((state) => state.toggleIO);
  const setIOLabel = useIOEditStore((state) => state.setIOLabel);
  const toggleIORequired = useIOEditStore((state) => state.toggleIORequired);
  const reorderIO = useIOEditStore((state) => state.reorderIO);
  return {
    ioEditMode,
    ioPreviewOpen,
    workflowIO,
    toggleIO,
    setIOLabel,
    toggleIORequired,
    reorderIO,
  };
}
export type IOEditContextValue = ReturnType<typeof useIOEditContext>;

/* ────────────────────────────────────────────────────────────────────────
 *  NodeIdChip — 节点头部 `#id` 章，点击弹出 JSON 查看器。
 *  数据来自 store hook `useNodeJsonViewer`（弹层本身的挂点在 WorkflowStores）。
 * ──────────────────────────────────────────────────────────────────────── */
export function NodeIdChip({
  nodeId,
  variant,
}: {
  nodeId: string;
  variant: "node" | "subgraph";
}) {
  const viewerApi = useNodeJsonViewer();
  const ref = React.useRef<HTMLButtonElement | null>(null);
  const requestShow = viewerApi.requestShow;
  /* 右上角显示**节点真实 id**（与 ComfyUI 一致，便于和日志/JSON/报错对号）。
   * 这里曾经跟「项目画布节点短序号」一起被改成按 `detail.nodes` 下标映射的
   *  `#1/#2…`（ISSUE #394）：那个短序号是项目画布自己的展示约定，工作流编辑器
   * 画布不是它的语义范围 —— 改回去之后，编辑器的 `#1670` 与 JSON 查看器、
   * 执行日志、ComfyUI 报错里的 id 逐字一致。 */

  const handleOpen = (e: React.SyntheticEvent) => {
    e.stopPropagation();
    const el = e.currentTarget as HTMLElement;
    requestShow(el, nodeId, variant);
  };

  return (
    <Hint label={`查看节点 ${nodeId} 在工作流 JSON 中的原始数据`}>
      <Button
        ref={ref}
        variant="outline"
        data-node-id-chip={nodeId}
        data-variant={variant}
        onClick={handleOpen}
        onMouseDown={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
        onDoubleClick={(event) => event.stopPropagation()}
        aria-label={`查看节点 #${nodeId} 的原始 JSON 数据`}
        className={
          variant === "subgraph"
            ? "nodrag nopan group border-primary-400/40 bg-primary-500/10 text-primary-strong hover:border-primary-300/70 hover:bg-primary-500/25 focus:ring-primary-400/40 inline-flex h-auto shrink-0 cursor-pointer items-center gap-0.5 rounded px-1 font-mono text-[9.5px] font-semibold tracking-wider uppercase focus:ring-1 focus:outline-none"
            : "nodrag nopan group border-info/45 bg-info/15 text-info-strong hover:border-info/70 hover:bg-info/25 focus:ring-info/40 inline-flex h-auto shrink-0 cursor-pointer items-center gap-0.5 rounded px-1 font-mono text-[9.5px] font-semibold focus:ring-1 focus:outline-none"
        }
      >
        <span aria-hidden style={{ fontSize: 9, lineHeight: 1 }}>
          🔍
        </span>
        <span>#{nodeId}</span>
      </Button>
    </Hint>
  );
}

/** rgthree Power Lora Loader — 每行参数暴露的勾选（输入→左；输出→右）。 */
export function IoCheckbox({
  ioRef,
  io,
}: {
  ioRef: IoRef;
  io: IOEditContextValue;
}) {
  const key = `${ioRef.nodeId}::${ioRef.kind}::${ioRef.name}`;
  const checked = !!io.workflowIO[key];
  const isOut = ioRef.direction === "output";
  const dirLabel = isOut ? "输出" : "输入";
  return (
    <Checkbox
      checked={checked}
      onCheckedChange={() => io.toggleIO(ioRef)}
      onClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
      title={
        checked
          ? `已暴露为工作流${dirLabel}`
          : `点击将其暴露为工作流${dirLabel}`
      }
      className="size-3.5"
      style={{
        width: 13,
        height: 13,
        marginLeft: isOut ? 6 : 0,
        marginRight: 6,
        flex: "0 0 auto",
        accentColor: checked ? "#fbbf24" : "#a1a1aa",
        cursor: "pointer",
      }}
    />
  );
}
