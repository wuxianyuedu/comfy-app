"use client";

/**
 * workflow-node-parts.tsx — 工作流节点卡片的共享视觉部件（唯一事实源）。
 *
 * 项目画布（project-canvas/WorkflowNode.tsx）与工作流库
 * （workflow-library/WorkflowCanvasNodePreview.tsx）都必须从这里取卡片部件。
 * 此前工作流库手搓了一份「画布样式预览」，宽度（340 vs 380）、状态胶囊、
 * outputs 行、按钮圆角全部漂移——用户要求「工作流库中的节点展示与项目画布
 * 完全一致」，故把卡片部件收敛到这里，两侧只允许组合、不允许复刻。
 *
 * 视觉 token（Ardot 714503087315759 v5）：
 *   卡片宽 380 / 圆角 14 / 边框与底色走语义 token
 *   Header h-8 · W 图标 #2A1F4A r14 28×28 + 右侧胶囊
 *   ActionBtn h-43 渐变 --color-primary→--color-accent，rounded-b-[14px]
 */

import React from "react";

import { Button } from "~/components/ui/button";
import { ioLabel, typeDisplay } from "~/components/studio/workflow-io";
import type { WorkflowIOEntry } from "~/components/studio/workflow-io";

/** 卡片外壳：与 CanvasNode 持有的外壳完全一致（无 overflow-hidden，
 *  保护端点骑跨；底部按钮自带 rounded-b-[14px] 贴合圆角）。 */
export function WorkflowNodeCardShell({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`border-border-strong bg-card relative w-[380px] rounded-[14px] border shadow-xl shadow-black/6 dark:shadow-black/30 ${className}`}
    >
      {children}
    </div>
  );
}

/** 头部：W 图标 + 标题 + 右侧胶囊（画布放节点序号，库内放运行状态）。 */
export function WorkflowNodeHeader({
  title,
  titleTitle,
  right,
}: {
  title: string;
  titleTitle?: string;
  right?: React.ReactNode;
}) {
  return (
    <div className="flex h-8 min-w-0 items-center justify-between gap-2 pr-[14px] pl-[14px]">
      <div className="flex min-w-0 items-center gap-2">
        <span
          aria-label="类型 工作流"
          className="text-primary flex h-7 w-7 shrink-0 items-center justify-center rounded-[14px] text-[14px] font-bold"
          style={{ background: "#2A1F4A", fontFamily: "var(--font-sans)" }}
        >
          W
        </span>
        <span
          className="text-ink-bright truncate text-[14px] font-bold"
          style={{ fontFamily: "var(--font-sans)" }}
          title={titleTitle ?? title}
        >
          {title}
        </span>
      </div>
      {right}
    </div>
  );
}

/** 分隔线 1px --color-border-strong。 */
export function WorkflowNodeDivider() {
  return <div className="bg-border-strong h-px" />;
}

/** 右侧胶囊（h-5 r11 bg --color-node-accent px-2），内容由调用方给。 */
export function WorkflowNodePill({
  children,
  title,
}: {
  children: React.ReactNode;
  title?: string;
}) {
  return (
    <div
      className="bg-node-accent flex h-5 shrink-0 items-center gap-[5px] rounded-[11px] px-2"
      title={title}
    >
      {children}
    </div>
  );
}

/** 只读 chip（库内预览用，视觉与画布交互 chip 同 token：h-6 r8 紫描边 +
 *  --color-node-accent 底）。 */
export function WorkflowStaticChip({
  children,
  className = "",
  title,
}: {
  children: React.ReactNode;
  className?: string;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={`border-primary/35 bg-node-accent flex h-6 shrink-0 items-center gap-1.5 rounded-lg border px-2.5 ${className}`}
    >
      {children}
    </span>
  );
}

/** 底部渐变按钮（rounded-b-[14px] 贴合 Card 圆角，与画布 ActionBtn 同款）。 */
export function WorkflowNodeActionButton({
  label,
  disabled = false,
  onClick,
  title,
}: {
  label: React.ReactNode;
  disabled?: boolean;
  onClick?: () => void;
  title?: string;
}) {
  return (
    <Button
      variant="ghost"
      disabled={disabled}
      onClick={onClick}
      title={title}
      className="nodrag nopan from-primary to-accent h-[43px] w-full justify-center gap-2 rounded-t-none rounded-b-[14px] bg-linear-to-r text-[13px] font-bold text-white shadow-[0_4px_12px_rgba(124,92,252,0.35)] hover:opacity-95"
      style={{ fontFamily: "var(--font-sans)" }}
    >
      {label}
    </Button>
  );
}

/** outputs 单行 labelRow（与画布 WorkflowNode 的 outputs 行镜像同构）。
 *  库内无 React Flow 上下文，不能渲染 PortHandle——`renderHandle` 由画布
 *  传入（端点几何在此维护），库内不传则只渲染 label + type chip。
 *  label 走 ioLabel 组内去重（与画布一致：同 group 同名回退 name）。 */
export function WorkflowNodeOutputsRow({
  output,
  inputs,
  outputs,
  renderHandle,
}: {
  output: WorkflowIOEntry & { ioKey: string };
  inputs: (WorkflowIOEntry & { ioKey: string })[];
  outputs: (WorkflowIOEntry & { ioKey: string })[];
  renderHandle?: (arg: {
    id: string;
    dir: "out";
    type: string;
  }) => React.ReactNode;
}) {
  const oLabel = ioLabel(output, [...inputs, ...outputs]);
  const oType = output.type ?? "*";
  return (
    <div key={output.nodeId + ":" + output.name} className="relative">
      {renderHandle && output.ioKey
        ? renderHandle({ id: output.ioKey, dir: "out", type: oType })
        : null}
      <div className="flex h-5 items-center justify-end gap-1.5 px-[14px] pt-1.5">
        <span
          className="text-ink-bright min-w-0 truncate text-[14px] font-semibold"
          style={{ fontFamily: "var(--font-sans)" }}
          title={`IO 输出 · ${oLabel}${oType ? ` · ${oType}` : ""}`}
        >
          {oLabel}
        </span>
        <span
          className="bg-border-strong text-ink-muted inline-flex shrink-0 items-center rounded-[3px] px-1.5 py-0.5 text-[12px] font-semibold"
          style={{ fontFamily: "var(--font-sans)" }}
        >
          {typeDisplay(oType)}
        </span>
      </div>
      <div className="pb-2" />
    </div>
  );
}
