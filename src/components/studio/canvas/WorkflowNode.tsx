"use client";
/* FlowNode（自定义 ComfyUI 图节点渲染器）—— 编排节点卡片。
 * 重块已拆成兄弟模块：
 *   - workflow-node-entries.ts      （输入 / 输出行分桶 hook）
 *   - workflow-node-palette.ts      （模式 / 角色配色计算）
 *   - FlowNodeHeader.tsx            （标题栏）
 *   - FlowNodeCollapsedAnchors.tsx  （折叠态圆柱 + 句柄）
 *   - FlowNodePinRows.tsx           （顶部针脚连接行）
 *   - FlowNodeWidgetRows.tsx        （widget / 旋钮行）
 * 原本内联在 WorkflowCanvasEditor.tsx 里。 */
import React, { useState } from "react";
import { useTheme } from "next-themes";
import { Handle, Position } from "@xyflow/react";
import { friendlyNodeTitle } from "~/lib/comfyui/node-titles";
import { PackageFooter } from "./PackageFooter";
import { DebugChainFooter } from "../debug/DebugChainFooter";
import { getWorkflowRenderChainModules } from "./workflow-render-chain";
import { useDebugStore } from "../debug/debug-store";
import { NODE_TITLE_H, resolveNodePackage } from "../workflow-utils";
import { FrontendOnlyBadge } from "../RequiredSummary";
import {
  RgthreeFastGroupsBypasserBody,
  RgthreePowerLoraLoaderBody,
  RgthreeLabelBody,
} from "./RgthreeBodies";
import { FrostLayer } from "./NodeFrost";
import { WorkflowImagePreview } from "../WorkflowImagePreview";
import { useIOEditContext } from "./IOEditContext";
import { useHoverElevation } from "../workflow-editor/HoverElevation";
import { useFlowNodeEntries } from "./workflow-node-entries";
import {
  computeNodePalette,
  DARK_PALETTE_BASE,
  LIGHT_PALETTE_BASE,
} from "./workflow-node-palette";
import { FlowNodeHeader } from "./FlowNodeHeader";
import { FlowNodeCollapsedAnchors } from "./FlowNodeCollapsedAnchors";
import { FlowNodePinRows } from "./FlowNodePinRows";
import { FlowNodeWidgetRows } from "./FlowNodeWidgetRows";
import type { WorkflowNodeData } from "../workflow-types";

/** 节点角色配色定义（assignedRole → 标签 + 强调色）。 */
export const PORT_ROLES: {
  key: string;
  label: string;
  color: string;
  bg: string;
}[] = [
  {
    key: "positiveNode",
    label: "正向提示词",
    color: "#a78bfa",
    bg: "rgba(167,139,250,0.15)",
  },
  {
    key: "negativeNode",
    label: "反向提示词",
    color: "#f87171",
    bg: "rgba(248,113,113,0.15)",
  },
  {
    key: "checkpointNode",
    label: "模型(Checkpoint)",
    color: "#60a5fa",
    bg: "rgba(96,165,250,0.15)",
  },
  {
    key: "samplerNode",
    label: "采样器",
    color: "#fb923c",
    bg: "rgba(251,146,60,0.15)",
  },
  {
    key: "inputImageNode",
    label: "输入图像",
    color: "#22d3ee",
    bg: "rgba(34,211,238,0.15)",
  },
];

/* ── 流画布的节点数据（必须满足 Record<string, unknown>，@xyflow/react 要求） ── */
export const INPUT_ROW_HEIGHT = 22; // px per input row (matches the py-1 + text-[11px] row)
export const HEADER_TOTAL = 60; // header (32) + #id bar (22) + small breathing room (6)

/*（注：以前用这些常量覆盖 `<Handle top: ...>`，好让句柄与行
 *  对齐。现在不这么做了 —— React Flow 会自动把每个句柄钉到
 *  其行的 `top: 50%`。常量留着，供日后布局改动参考。） */

export const FlowNode = React.memo(function FlowNode({
  data,
  selected,
}: {
  data: WorkflowNodeData;
  selected?: boolean;
}) {
  const role = PORT_ROLES.find(
    (PORT_ROLES) => PORT_ROLES.key === data.assignedRole,
  );
  const io = useIOEditContext();
  /* 视口缩放**不再**在这里订阅 —— 缩放的读取
   *  挪进了 <FrostLayer>，缩放时只有磨砂节点重渲染。 */
  const debugMode = useDebugStore((state) => state.debugMode);

  /* 悬浮置顶：鼠标指着的节点压住连线（ISSUE #400）。
   *  状态是本节点自己的 —— 鼠标进出只重渲染被指的这一个节点。 */
  const { hoverHandlers, hoverRef } = useHoverElevation();

  /* 输入 / 输出行分桶与配色住在兄弟模块里，
   *  下面的渲染器只编排布局。 */
  const entries = useFlowNodeEntries(data);
  /* 节点卡片表面色（body / header / border / title / dot）与主题联动 ——
   *  与画布其它表面的口径一致，浅色下是一张浅卡，深色下取回原深色。
   *  resolvedTheme 在首帧可能还是 undefined（挂载前），此时按 Dark 起步，
   *  与 ThemeProvider 的 defaultTheme 一致，避免闪一帧浅卡。 */
  const { resolvedTheme } = useTheme();
  const palette = computeNodePalette(
    data,
    role,
    resolvedTheme === "light" ? LIGHT_PALETTE_BASE : DARK_PALETTE_BASE,
  );

  /* 折叠态（ComfyUI LiteGraph 的 `flags.collapsed`）。导入配置里的
   *  标记只播下**初始**值；此后由用户开关接管状态
   *  （天真地写 `dataCollapsed || userCollapsed` 会让
   *  初始就折叠的节点永远展不开）。 */
  const [userCollapsed, setUserCollapsed] = useState<boolean>(
    data.flags?.collapsed === true,
  );
  const isCollapsed = userCollapsed;

  /* 显示标题优先用 zh-CN 友好映射 → ComfyUI 的原始 `title` →
   *  美化后的 class_type。 */
  const displayTitle = friendlyNodeTitle(data.classType, data.title, "zh");
  /* rgthree Label 节点的文字铺满整张卡片，没有**独立的**
   *  ComfyUI 标题栏 —— 对它们抑制标准头部。 */
  const isLabel = data.classType === "Label (rgthree)";
  /* rgthree Power Lora Loader 自带 Lora 堆栈主体 —— 这个
   *  classType 跳过标准 widget 主体区。 */
  const isPowerLoraLoader = data.classType === "Power Lora Loader (rgthree)";

  /* 导入配置带精确盒子尺寸时，节点被强制成
   *  那几个尺寸；卡片体则按原始**内容**高度伸缩。 */
  const hasSize = !!data.size;

  return (
    <div
      className="relative flex flex-col rounded-lg border shadow-[0_4px_20px_rgba(0,0,0,0.55)]"
      ref={hoverRef}
      data-node-id={data.nodeId}
      {...hoverHandlers}
      style={{
        // 宽度在有 ComfyUI 保存的 `size.w` 时跟随它；高度交给
        // 内容驱动（`auto`），卡片随端口 / widget 长高，
        // 折叠时缩回标题栏高度。
        width: hasSize ? data.size?.w : undefined,
        height: "auto",
        minWidth: hasSize
          ? data.size?.w
          : entries.outputs.length > 0
            ? 268
            : 248,
        // data.size.h 是**卡片体内容**高度；外层 div 还包含
        // 钉住的 NODE_TITLE_H 标题栏，所以下限是内容 + 标题。
        minHeight: isCollapsed
          ? NODE_TITLE_H
          : hasSize
            ? (data.size?.h ?? 0) + NODE_TITLE_H
            : undefined,
        // 不设 maxWidth 上限 —— ComfyUI 允许用户自由缩放节点框。
        borderColor: palette.nodeBorder,
        // 模式（旁路 / 停用）节点经 <FrostLayer> + 真实模糊着色，所以
        // 根节点透明（isolation 把磨砂限制在本节点内）。
        // 普通节点保留实心面板。
        isolation: "isolate",
        background: palette.modeColor ? "transparent" : palette.nodeBg,
        outline: selected ? "2px solid rgba(56,189,248,0.9)" : "none",
        outlineOffset: selected ? "2px" : undefined,
      }}
    >
      {palette.modeColor && palette.nodeMode !== 0 && (
        <FrostLayer color={palette.modeColor} nodeMode={palette.nodeMode} />
      )}
      {/* 头部 —— 钉在 NODE_TITLE_H（litegraph 的 NODE_TITLE_HEIGHT）。
       *  rgthree Label 节点整个抑制（见 `isLabel`）。 */}
      {!isLabel && (
        <FlowNodeHeader
          data={data}
          role={role}
          io={io}
          outputs={entries.outputs}
          isCollapsed={isCollapsed}
          onToggleCollapsed={() => setUserCollapsed((value) => !value)}
          palette={palette}
          displayTitle={displayTitle}
        />
      )}

      {/* 折叠态句柄锚点 —— 装饰性圆柱 + 不可见的
       *  每端口 Handle，切换时连线永不脱落。 */}
      {isCollapsed && (
        <FlowNodeCollapsedAnchors
          data={data}
          orderedEntries={entries.orderedEntries}
          outputs={entries.outputs}
        />
      )}

      {/* 顶部针脚区 —— 纯连接型输入与输出配在
       *  同一行。折叠时隐藏。 */}
      {!isCollapsed &&
        (entries.uniqueConnEntries.length > 0 ||
          entries.outputs.length > 0) && (
          <FlowNodePinRows
            data={data}
            io={io}
            rawMeta={entries.rawMeta}
            uniqueConnEntries={entries.uniqueConnEntries}
            outputs={entries.outputs}
          />
        )}

      {/* Widget 输入区 —— 只有旋钮。Power Lora
       *  Loader 跳过（它自带堆栈），折叠时隐藏。 */}
      {!isCollapsed &&
        entries.visibleWidgetEntries.length > 0 &&
        !isPowerLoraLoader && (
          <FlowNodeWidgetRows
            data={data}
            io={io}
            rawMeta={entries.rawMeta}
            visibleWidgetEntries={entries.visibleWidgetEntries}
            hasSize={hasSize}
          />
        )}

      {/* rgthree Fast Groups Bypasser 运行时主体 —— 每个匹配 `matchTitle`
       *  的分组一行开关（PATCH → 写入 rawJson）。 */}
      {data.classType === "Fast Groups Bypasser (rgthree)" &&
        typeof data.properties?.matchTitle === "string" && (
          <RgthreeFastGroupsBypasserBody
            matchTitle={data.properties.matchTitle}
            groups={data.groups ?? []}
          />
        )}

      {/* rgthree Power Lora Loader 运行时主体 —— 由 `widgets_values`
       *  渲染 lora 堆栈。只读。 */}
      {data.classType === "Power Lora Loader (rgthree)" && (
        <RgthreePowerLoraLoaderBody widgets={data.rawWidgetValues ?? []} />
      )}

      {/* rgthree Label 运行时主体 —— 按 `properties` 里的样式
       *  绘制标题，铺满这张（无头部的）卡片。 */}
      {isLabel && (
        <RgthreeLabelBody
          text={data.title}
          properties={data.properties ?? {}}
        />
      )}

      {/* IMAGE 输入的内联缩略图预览 —— 每个带
       *  `preview: true` 的 rawInput（LoadImage 家族）都在卡片体
       *  尾部得到一个 ComfyUI 风格的预览。 */}
      {!isCollapsed && entries.imagePreviewEntries.length > 0 && (
        <div className="flex flex-col gap-2 px-2 pt-1 pb-2">
          {entries.imagePreviewEntries.map((entry) => (
            <WorkflowImagePreview key={entry.name} entry={entry} />
          ))}
        </div>
      )}

      {/* 完全没有输入的节点的默认目标句柄 ——
       *  未映射 / 兜底的边总得有个地方锚定。
       *
       *  这个 Handle 之前是可见的紫色圆点，但无输入的节点
       *  （各类 Loader / EmptyLatentImage …）本就没有入端口，左侧挂一颗
       *  孤零零的圆点看起来像渲染 bug。改为完全透明 + isConnectable=false：
       *  连线锚点能力保留（避免既有 fallback 边断开），视觉上不再出现。 */}
      {entries.uniqueConnEntries.length === 0 &&
        entries.uniqueWidgetEntries.length === 0 && (
          <Handle
            type="target"
            position={Position.Left}
            id="__default_in"
            isConnectable={false}
            className="!h-2.5 !w-2.5 !border-0"
            style={{ left: -5, opacity: 0, pointerEvents: "none" }}
          />
        )}

      {/* 通用源句柄 —— 始终存在但不可见，好让解析不出精确
       *  "out:<name>" 句柄的边仍能锚定。 */}
      <Handle
        type="source"
        position={Position.Right}
        id="out"
        isConnectable={false}
        style={{ opacity: 0, right: -5 }}
      />

      {/* ComfyUI 原生左下角底栏：包来源 + frontend_only
       *  徽标。折叠时都隐藏。 */}
      {!isCollapsed && (
        <>
          <PackageFooter
            classType={data.classType}
            name={resolveNodePackage(data.classType, data.properties)}
          />
          {data.properties?.frontend_only === true && <FrontendOnlyBadge />}
        </>
      )}
      {/* 调试模式 — 非折叠时在 PackageFooter 下方渲染渲染链路
       *  模块标签（仅 debugMode 开启时由 DebugChainFooter 自行显示）。 */}
      {!isCollapsed && debugMode && (
        <DebugChainFooter
          modules={getWorkflowRenderChainModules(data.classType)}
        />
      )}
    </div>
  );
});
