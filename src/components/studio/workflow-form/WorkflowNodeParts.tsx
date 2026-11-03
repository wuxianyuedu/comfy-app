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
 *   ActionBtn h-43 渐变 --color-primary→--color-accent，rounded-b-node
 */

import React from "react";

import { Button } from "~/components/ui/button";
import { Hint } from "~/components/ui/hint";
import { ioLabel, typeDisplay } from "~/components/studio/workflow-io";
import { TypeChip } from "~/components/studio/TypeChip";
import { cn } from "~/lib/utils";
import type { WorkflowIOEntry } from "~/components/studio/workflow-io";

/** 卡片外壳：与 CanvasNode 持有的外壳完全一致（无 overflow-hidden，
 *  保护端点骑跨；底部按钮自带 rounded-b-node 贴合圆角）。 */
export function WorkflowNodeCardShell({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`border-border-strong bg-card rounded-node relative w-95 border shadow-xl shadow-black/6 dark:shadow-black/30 ${className}`}
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
  right?: React.ReactNode;
  title: string;
  titleTitle?: string;
}) {
  return (
    <div className="flex h-8 min-w-0 items-center justify-between gap-2 pr-3.5 pl-3.5">
      <div className="flex min-w-0 items-center gap-2">
        <span
          aria-label="类型 工作流"
          className="text-primary rounded-node flex size-7 shrink-0 items-center justify-center text-sm font-bold"
          style={{ background: "#2A1F4A", fontFamily: "var(--font-sans)" }}
        >
          W
        </span>
        <span
          className="text-ink-bright truncate text-sm font-bold"
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

/** 右侧胶囊（h-5 r11 bg --color-node-accent px-2），内容由调用方给。
 *
 * 形状在这里、**底色不在**：画布节点用的是 `--color-overlay-accent-surface`
 * （「浮层/chip 强调底」）、库卡与 Ardot 还原件用 `--color-node-accent`
 * （「节点强调底」）。两档浅色只差 1/255（`#f2eeff` vs `#f1edff`）、暗色差得明显
 * （`#1e1a2e` vs `#241f38`），是两颗语义不同的 token，不该借「去重」并成一颗 ——
 * 所以差异用 `className` 补，实测 `cn()` 认 `bg-<名>` 为同一组、后写的赢。 */
export function WorkflowNodePill({
  children,
  title,
  className,
}: {
  children: React.ReactNode;
  className?: string;
  title?: string;
}) {
  return (
    <div
      className={cn(
        "bg-node-accent flex h-5 shrink-0 items-center gap-1.25 rounded-[11px] px-2",
        className,
      )}
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
      className={`border-primary/35 bg-node-accent flex h-6 shrink-0 items-center gap-1.5 rounded-lg border px-2.5 ${className}`}
      title={title}
    >
      {children}
    </span>
  );
}

/**
 * 底部那枚「▶ 用此工作流生成」（Ardot ActionBtn 340×43：全宽渐变
 * `--color-primary`→`--color-accent` + 跟品牌走的投影）。
 *
 * **它是这个形状的唯一出处**：画布的功能版、画布的视觉稿、工作流库的卡片预览与
 * 「实际使用」面板此前各写一份（高度一枚写成 43px 的字面量、两枚 `h-10.75`；投影一枚进 class
 * 一枚进 `style`、hover 一档 95 一档 90、variant 一枚 ghost 两枚 primary-solid），
 * 逐行重合度已在 §12.12 的孪生判据射程内。调用点只允许组合，不允许复刻 ——
 * 契约 §Components 那条「被抽走的形状只许有一个出处」按标记集合钉着这件事。
 *
 * `hint` 传与不传**不只是有没有气泡**：`wrap` 的那层 `inline-flex` 锚点会让内部的
 * `w-full` 按钮按内容宽定尺寸。所以没文案时给裸按钮、有文案时才套锚点，两态宽度一致。
 */
export function WorkflowNodeActionButton({
  label,
  disabled = false,
  onClick,
  hint,
  corner = "own",
}: {
  /** `own` = 卡片不裁切，按钮自带下沿圆角；`clipped` = 卡片 `overflow-hidden`，四角交还给卡片。 */
  corner?: "own" | "clipped";
  disabled?: boolean;
  hint?: string;
  label: React.ReactNode;
  onClick?: () => void;
}) {
  const button = (
    <Button
      className={cn(
        "from-primary to-accent nodrag nopan flex h-10.75 w-full items-center justify-center gap-2 bg-linear-to-r text-sm font-bold text-white shadow-[0_4px_12px_color-mix(in_srgb,var(--color-primary)_35%,transparent)] hover:opacity-95",
        /* 圆角是这一枚唯一按宿主分叉的形状：坐在卡片下沿时自己收角，并把顶角收成直角
         * （否则基元的 `rounded-lg` 会在按钮上沿留出两个缺口）；卡片已经 `overflow-hidden`
         * 时四角全部交还给卡片。分叉只放在这一段 —— 上面那行是判据按「标记集合全命中」
         * 认的那枚形状，往里塞形态就是往唯一出处里塞第二份来源。 */
        corner === "own" ? "rounded-b-node rounded-t-none" : "rounded-none",
      )}
      disabled={disabled}
      onClick={onClick}
      style={{ fontFamily: "var(--font-sans)" }}
      variant="primary-solid"
    >
      {label}
    </Button>
  );
  return hint !== undefined && hint !== "" ? (
    <Hint label={hint} wrap>
      {button}
    </Hint>
  ) : (
    button
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
  inputs: Array<WorkflowIOEntry & { ioKey: string }>;
  output: WorkflowIOEntry & { ioKey: string };
  outputs: Array<WorkflowIOEntry & { ioKey: string }>;
  renderHandle?: (arg: { dir: "out"; id: string; type: string }) => React.ReactNode;
}) {
  const oLabel = ioLabel(output, [...inputs, ...outputs]);
  const oType = output.type ?? "*";
  return (
    <div className="relative" key={`${output.nodeId}:${output.name}`}>
      {renderHandle && output.ioKey
        ? renderHandle({ id: output.ioKey, dir: "out", type: oType })
        : null}
      <div className="flex h-5 items-center justify-end gap-1.5 px-3.5 pt-1.5">
        <span
          className="text-ink-bright min-w-0 truncate text-sm font-semibold"
          style={{ fontFamily: "var(--font-sans)" }}
          title={`IO 输出 · ${oLabel}${oType ? ` · ${oType}` : ""}`}
        >
          {oLabel}
        </span>
        <TypeChip size="md">{typeDisplay(oType)}</TypeChip>
      </div>
      <div className="pb-2" />
    </div>
  );
}
