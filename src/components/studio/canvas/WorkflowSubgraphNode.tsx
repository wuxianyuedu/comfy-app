"use client";
/* ComfyUI 子图封装节点渲染器 —— 纯渲染组合层，按视觉区域拆分在同目录：
 * SubgraphHeader.tsx（标题栏）、SubgraphCollapsedAnchors.tsx（折叠锚点）、
 * SubgraphPinRows.tsx（针脚行）、SubgraphWidgetRow.tsx（LABEL|VALUE 行）、
 * SubgraphWidgetStackedString.tsx（STRING 堆叠块）；数据预处理收在下方 useMemo。 */
import React, { useMemo, useState } from "react";

import { sanitizeComboLabel, NODE_TITLE_H, hexToRgba } from "../workflow-utils";
import type { WorkflowSubgraphData, RawInputMeta } from "../workflow-types";
import { FrostLayer } from "./NodeFrost";
import { useIOEditContext } from "./IOEditContext";
import { SubgraphHeader } from "./SubgraphHeader";
import { useHoverElevation } from "../workflow-editor/HoverElevation";
import { SubgraphCollapsedAnchors } from "./SubgraphCollapsedAnchors";
import { SubgraphPinRows } from "./SubgraphPinRows";
import { SubgraphWidgetRow } from "./SubgraphWidgetRow";
import { SubgraphWidgetStackedString, stackedStringRow } from "./SubgraphWidgetStackedString";

/* 暴露口的显示名。wrapper 本层槽位名是 ComfyUI 自动编号的别名
 * （`value_1`），业务名在内部真实字段上（proxyField，服务端由
 * `properties.proxyWidgets` 解析）。先取内部字段的 label → localized →
 * 字段名，再回退本层 label/localized/别名——IO 面板用同一条链
 * （见 workflow-detail-io 的富化），两处逐字一致。 */
const exposedName = (inp: RawInputMeta): string =>
  sanitizeComboLabel(inp.proxyField?.label) ||
  sanitizeComboLabel(inp.proxyField?.localized) ||
  sanitizeComboLabel(inp.proxyField?.field) ||
  sanitizeComboLabel(inp.label) ||
  sanitizeComboLabel(inp.localized) ||
  inp.name ||
  "";

export const WorkflowSubgraphNode = React.memo(function WorkflowSubgraphNode({
  data,
  selected,
}: {
  data: WorkflowSubgraphData;
  selected?: boolean;
}) {
  const io = useIOEditContext();
  /* 悬浮置顶：与 FlowNode 同一套语义（ISSUE #400）—— 鼠标指着的子图卡片
   *  也要压住连线。状态在本节点内，悬浮进出不影响其余节点。 */
  const { hoverHandlers, hoverRef } = useHoverElevation();

  /* 这里不再订阅视口缩放（只有磨砂节点需要跟缩放，见 FlowNode / FrostLayer）。
   * 父图子图卡片与 WorkflowNode 两区布局对齐：紫色头部 + 顶部 PINS 区
   *（纯连线输入左圆点与暴露输出右圆点按 22px 行拉链成对）+ WIDGET 区
   *（LABEL|VALUE 行，仅槽位同时接线时才画圆点）；IO 行连接模型与普通节点完全相同。 */
  /* 子图身份色：默认紫色；封装节点自身被旁路时切成旁路粉（#ec4899），
   * 静音时切成灰色。与 WorkflowNode 的「模式 → 颜色」逻辑一致。 */
  const nodeMode = data.mode ?? 0;

  /*  子图封装节点与 WorkflowNode 一样，经 <NodeFrost> 用**真实**的
   *  `backdrop-filter` —— 按 1/缩放 反向缩放，避开 Chromium 在低缩放下的
   *  重复平铺伪影。<PseudoFrostLayer> 仍是不启用的兜底。 */
  const accent = nodeMode === 4 ? "#ec4899" : nodeMode === 2 ? "#6b7280" : "#7C5CFC"; // subgraph default purple identity (mode 0)

  /* 外框语义与 WorkflowNode 相同：导入的配置带显式尺寸时，
   *  根 div 被强制成 width/height: 100%（见下面的 `style` 块），
   *  卡片因此填满 React Flow 的节点框。多行文本框随之接入 flex 链，
   *  填满框内剩余的纵向空间，而不是被钉在一个固定的像素高度上。 */
  const hasSize = !!data.size;

  /* 用户可切换的折叠状态。与 WorkflowNode 一致：左侧的折叠箭头在
   *  「只有头部」与「完整主体」之间切换。
   *  `userCollapsed` 的初值取自导入的 `flags.collapsed`，
   *  这样一开始就折叠的子图仍能靠开关展开（与 WorkflowNode 同一个
   *  `true || 任何值` 的坑 —— 两者**不能**做或运算）。 */
  const [userCollapsed, setUserCollapsed] = useState<boolean>(data.flags?.collapsed === true);
  const isCollapsed = userCollapsed;

  /* 过滤空标签行，并把封装输入拆成两桶（收进 memo）：connInputs 为纯类型端口，
   * 左边缘常亮圆点、与输出在 PINS 区成对（带 isConnection 的封装输入也归此）；
   * widgetInputs 为暴露 widget 槽，渲染 LABEL|VALUE，仅 isConnection/isBoundary 时画圆点。
   * 判据按 `widget` 标记（封装节点 widgets_values 为空，旧 widgetValue 判据永不成立；ComfyUI 导出总带该标记）。
   * 空标签哨兵 IO（如 outputs[11] {name:"",type:"*",label:"PREVIEW"}）必须过滤，否则渲染出空 22px 行。 */
  const { connInputs, widgetInputs, cleanedOutputs } = useMemo(() => {
    const cleanedInputs = data.inputs
      .map((inp) => ({ inp, label: exposedName(inp) }))
      .filter(({ label }) => label.trim().length > 0);
    const cleanedOutputs = (data.outputs ?? [])
      .map((out) => ({
        out,
        display:
          sanitizeComboLabel(out.label) || sanitizeComboLabel(out.localized) || out.name || "",
      }))
      .filter(({ display }) => display.trim().length > 0);
    return {
      connInputs: cleanedInputs.filter(({ inp }) => !inp.widget && !inp.isConnection),
      widgetInputs: cleanedInputs.filter(({ inp }) => !!inp.widget || inp.isConnection === true),
      cleanedOutputs,
    };
  }, [data.inputs, data.outputs]);

  /* 首个输出口名 —— 空数组即没有（`outputRef` 传 null）。 */
  const firstOutputName = cleanedOutputs.at(0)?.out.name;

  return (
    <div
      className={`relative flex flex-col rounded-lg border shadow-[0_6px_22px_var(--color-shadow-strong)] ${
        nodeMode === 0 ? "bg-node" : "bg-transparent"
      }`}
      data-node-id={data.nodeId}
      ref={hoverRef}
      {...hoverHandlers}
      style={{
        // 有 ComfyUI 保存的 `size.w` 时宽度就跟随它（固定宽度框，
        //  与 ComfyUI 完全一致 —— 只有高度是流动的）。
        //  没带尺寸时回落到一个合理的最小宽度。
        width: data.size ? data.size.w : undefined,
        // 两种状态下高度都完全由内容驱动（`auto`）：展开时子图卡片随 pin 一起
        //  变高，折叠时自动收到标题栏那么高。
        //  `minHeight` 下限保证展开的框不会低于 ComfyUI 保存的 `size.h`；
        //  折叠态也永远不会低于它自己的标题栏。
        height: "auto",
        minWidth: data.size ? data.size.w : 280,
        // data.size.h 是**主体内容**高度（size[1]）。
        //  WorkflowSubgraphNode 的外层 div **包含**那条钉死的 30px 标题栏，
        //  因此总下限 = 内容 + 标题 = size[1] + 30。
        //  与 WorkflowNode 的修正一致，卡片才能填满 React Flow 的节点框，
        //  而不是矮 30px。
        minHeight: isCollapsed ? NODE_TITLE_H : data.size ? data.size.h + NODE_TITLE_H : undefined,
        // 这里同样不设 maxWidth 上限：ComfyUI 允许用户自由调整子图框，
        //  而我们必须尊重配置里带的 `size`
        //  （硬写 320 的上限会把用户在 ComfyUI 里明确调宽的框裁掉）。
        borderColor: hexToRgba(accent, 0.55),
        // 旁路 / 禁用子图的着色与真模糊在 <NodeFrost> 里；
        //  根节点保留 `isolation`，把磨砂层的负 z 关在里面；
        //  同时保持透明，磨砂才透得出来。
        //  普通子图用 `bg-node` 的实心面板（跟随主题）。
        isolation: "isolate",
        // ComfyUI 会给当前激活的节点画一圈亮色选中矩形。
        outline: selected === true ? "2px solid rgba(56,189,248,0.9)" : "none",
        outlineOffset: selected === true ? "2px" : undefined,
      }}
    >
      {accent && nodeMode !== 0 && <FrostLayer color={accent} nodeMode={nodeMode} />}
      {/* 头部 —— 紫色强调（子图身份）。与普通 WorkflowNode 头部同一个
       *  NODE_TITLE_H，好让带标题的节点在网格上对齐。 */}
      <SubgraphHeader
        accent={accent}
        io={io}
        isCollapsed={isCollapsed}
        nodeId={String(data.nodeId)}
        onEnter={data.onEnter}
        onToggle={() => {
          setUserCollapsed((value) => !value);
        }}
        outputRef={
          firstOutputName !== undefined && firstOutputName !== "" ? { name: firstOutputName } : null
        }
        title={data.title}
      />

      {/* 折叠态句柄锚点：连线型边界输入在左一根圆柱、声明了输出就在右一根，
       *  底下坐着不可见的每端口 <Handle>，让活连线几何在切换前后保持不变。 */}
      {isCollapsed && (
        <SubgraphCollapsedAnchors
          connectedInputs={data.connectedInputs}
          connectedOutputs={data.connectedOutputs}
          connInputs={connInputs}
          outputs={cleanedOutputs}
        />
      )}

      {/* 顶部针脚区 —— 纯连接型输入端口与暴露出的输出端口拉链式成对；
       *  用户 / 配置把章标成折叠时隐藏。 */}
      {!isCollapsed && (
        <SubgraphPinRows
          connInputs={connInputs}
          hostNodeId={data.hostNodeId}
          io={io}
          nodeId={data.nodeId}
          outputs={cleanedOutputs}
        />
      )}

      {/* Widget 区：暴露的包裹 widget 输入按 LABEL|VALUE 行排。仅槽位同时接线
          （isConnection/isBoundary）才挂目标 Handle；值照常显示。长 STRING 拆成上下堆叠块，章折叠时隐藏。 */}
      {!isCollapsed && widgetInputs.length > 0 && (
        /* widget 区与卡片同底（`bg-node`）：此前取 `bg-surface-1`（近黑），
         *  节点框改灰之后它会变成「灰框里的黑块」，nodeMode ≠ 0 时又必须
         *  有一层不透明底（磨砂在负 z，透明会把行压到画布上）。 */
        <div
          className="bg-node relative min-h-0 flex-1 py-0.5"
          style={{
            /* 值列改走两栏 grid：第 1 列 `max-content` 由**最长的参数名**撑出
             *  —— 所有行的值框共享同一起点 x；第 2 列 `minmax(64px, 1fr)`
             *  给值框固定最小宽度并随节点余宽伸展。行自身用 `subgrid` 借用
             *  同一组列轨道，跨行对齐由父 grid 统一裁决。 */
            display: "grid",
            gridTemplateColumns: "max-content minmax(64px, 1fr)",
            /* STRING 堆叠行的轨道给 `1fr`：定尺寸节点上吸收剩余高度，
             *  textarea 继续铺满；其余行轨道按内容收紧。 */
            gridTemplateRows: widgetInputs
              .map(({ inp }) => (stackedStringRow(inp) ? "minmax(0, 1fr)" : "max-content"))
              .join(" "),
            columnGap: 8,
            alignContent: "start",
          }}
        >
          {widgetInputs.map(({ inp, label }, i) =>
            stackedStringRow(inp) ? (
              <SubgraphWidgetStackedString
                hasSize={hasSize}
                hostNodeId={data.hostNodeId}
                inp={inp}
                io={io}
                key={`sub-w-${inp.name}-${i}`}
                label={label}
                nodeId={data.nodeId}
              />
            ) : (
              <SubgraphWidgetRow
                hostNodeId={data.hostNodeId}
                inp={inp}
                io={io}
                key={`sub-w-${inp.name}-${i}`}
                label={label}
                nodeId={data.nodeId}
              />
            ),
          )}
        </div>
      )}
    </div>
  );
});
