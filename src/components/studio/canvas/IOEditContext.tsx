"use client";
/* ════════════════════════════════════════════════════════════════════════
 *  wf-contexts.tsx — 消费方组件 + 兼容再导出（P2：Context → Zustand）
 * ────────────────────────────────────────────────────────────────────────
 *  原先这文件承载 3 个 React Context（IOEditContext / RgthreeGroupsContext /
 *  NodeJsonViewerContext）、对应的 Provider、节点 JSON 弹层（NodeJsonPopover）
 *  以及 IoCheckbox / NodeIdChip。
 *
 *  P2 迁移后：
 *   • 状态与动作收进 `wf-stores.ts`（createStore 工厂 + WFStoresContext 载体）。
 *   • NodeJsonPopover 抽到 `wf-node-json-popover.tsx`（打破循环依赖）。
 *   • 本文件保留可复用的消费型组件 IoCheckbox / NodeIdChip（改为经 store hook
 *     读取），并向上再导出 store 的 hook / 选择器 / Provider，让 wf-node /
 *     wf-subgraph-node 等消费方从同一文件取「io 风格」API，改动最小。
 * ════════════════════════════════════════════════════════════════════════ */
import React from "react";
import type { IoRef } from "../workflow-types";
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

/* ── 兼容再导出：消费方统一从 ./wf-contexts 取以下符号 ── */
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

/** 与旧 `useContext(IOEditContext)` 等价的值对象 —— 由 store 组合，方便
 *  wf-node / wf-subgraph-node 里的 `const io = useContext(IOEditContext)` 类
 *  调用点零改动替换为 `const io = useIOEditContext()`. */
export function useIOEditContext() {
  const workflowIO = useIOEditStore(selectWorkflowIO);
  const ioEditMode = useIOEditStore(selectIoEditMode);
  const ioPreviewOpen = useIOEditStore(selectIoPreviewOpen);
  const toggleIO = useIOEditStore((state) => state.toggleIO);
  const setIOLabel = useIOEditStore((state) => state.setIOLabel);
  const toggleIORequired = useIOEditStore((state) => state.toggleIORequired);
  const reorderIO = useIOEditStore((state) => state.reorderIO);
  const setIOValues = useIOEditStore((state) => state.setIOValues);
  const resetIOPreviewValues = useIOEditStore((state) => state.resetIOPreviewValues);
  return {
    ioEditMode,
    ioPreviewOpen,
    workflowIO,
    toggleIO,
    setIOLabel,
    toggleIORequired,
    reorderIO,
    setIOValues,
    resetIOPreviewValues,
  };
}
export type IOEditContextValue = ReturnType<typeof useIOEditContext>;

/* ────────────────────────────────────────────────────────────────────────
 * useWiredPinKeysRegistry — 把「这个节点现在画出了哪些可连的落点行」上报给
 * IOEdit store。对外参数卡片的候选端点据此收窄（见 IOEditState.wiredPinKeys）。
 *
 * 规则只有一条：**这份行名单与真实渲染同一帧产出**。所以调用方传进来的是
 * 「本节点这一帧渲染用到的行键数组」，本 hook 只做上报与卸载撤回 —— 任何
 * 「另算一份」的做法都会与渲染漂移，那正是「端点画在一颗落不上去的句柄上、
 * 拖过去出现禁用标记」的成因。
 * ──────────────────────────────────────────────────────────────────────── */
export function useWiredPinKeysRegistry(
  nodeId: string | undefined,
  wireKeys: readonly string[],
): void {
  const report = useIOEditStore((state) => state.reportNodeWiredPins);
  /* 内容签名：数组每次渲染都是新引用，直接进依赖表会每帧上报（每次 set 都
   * 产生新 Set → 卡片节点整批重建 → 画布卡死）。 */
  const signature = wireKeys.join("\u0000");
  React.useEffect(() => {
    if (!nodeId) return;
    const keys = signature.length > 0 ? signature.split("\u0000") : [];
    report(nodeId, keys);
    /* 卸载时撤回本节点那一份：节点没了，行也就没了，卡片不该再画端点。 */
    return () => report(nodeId, []);
  }, [nodeId, signature, report]);
}

/* ────────────────────────────────────────────────────────────────────────
 *  NodeIdChip — 节点头部 `#id` 章，点击弹出 JSON 查看器。
 *  原实现 `useContext(NodeJsonViewerContext)`；现改用 store hook `useNodeJsonViewer`。
 * ──────────────────────────────────────────────────────────────────────── */
export function NodeIdChip({ nodeId, variant }: { nodeId: string; variant: "node" | "subgraph" }) {
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
    <button
      ref={ref}
      type="button"
      data-node-id-chip={nodeId}
      data-variant={variant}
      onClick={handleOpen}
      onMouseDown={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      title={`查看节点 ${nodeId} 在工作流 JSON 中的原始数据`}
      aria-label={`查看节点 #${nodeId} 的原始 JSON 数据`}
      className={
        variant === "subgraph"
          ? "nodrag nopan group inline-flex shrink-0 cursor-pointer items-center gap-0.5 rounded border border-violet-400/40 bg-violet-500/10 px-1 font-mono text-[9.5px] font-semibold uppercase tracking-wider text-violet-200 transition-colors hover:border-violet-300/70 hover:bg-violet-500/25 hover:text-violet-50 focus:outline-none focus:ring-1 focus:ring-violet-400/40"
          : "nodrag nopan group inline-flex shrink-0 cursor-pointer items-center gap-0.5 rounded border border-cyan-400/45 bg-cyan-500/15 px-1 font-mono text-[9.5px] font-semibold text-cyan-200 transition-colors hover:border-cyan-300/70 hover:bg-cyan-500/25 hover:text-cyan-50 focus:outline-none focus:ring-1 focus:ring-cyan-400/40"
      }
    >
      <span aria-hidden style={{ fontSize: 9, lineHeight: 1 }}>🔍</span>
      <span>#{nodeId}</span>
    </button>
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
    <input
      type="checkbox"
      checked={checked}
      onChange={() => io.toggleIO(ioRef)}
      onClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
      title={checked ? `已暴露为工作流${dirLabel}` : `点击将其暴露为工作流${dirLabel}`}
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