"use client";
/* 抽出的 WorkflowSubgraphNode（ComfyUI 子图封装节点的渲染器）。
 * 原本在 WorkflowCanvasEditor.tsx 内部。 */
import React, { useState } from "react";
import { clamp } from "~/lib/clamp";
import { useTheme } from "next-themes";

import { Handle, Position } from "@xyflow/react";
import { portColor } from "~/lib/comfyui/types";
import { Z } from "~/lib/shell/overlay-z";
import { SelectMenu } from "~/components/ui/select-menu";
import type { WorkflowSubgraphData, RawInputMeta } from "../workflow-types";

/** COMBO 输入额外携带自己的候选清单（由导入管线盖章；
 *  不属于共享的 RawInputMeta 契约）。 */
type ComboInputMeta = RawInputMeta & { comboOptions?: unknown };
import {
  valueCellColor,
  renderSubgraphWidgetValue,
  sanitizeComboLabel,
  NODE_TITLE_H,
  hexToRgba,
} from "../workflow-utils";
import { FrostLayer } from "./NodeFrost";
import { StringTextarea } from "../StringTextarea";
import { useIOEditContext, IoCheckbox } from "./IOEditContext";
import { SubgraphHeader } from "./SubgraphHeader";
import { useHoverElevation } from "../workflow-editor/HoverElevation";
import { resolveAnchorCylinder } from "./workflow-node-palette";
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
  /* 收起态的锚柱跟主题联动（浅色下白描白会让锚柱整个消失）。 */
  const { resolvedTheme } = useTheme();
  const anchor = resolveAnchorCylinder(resolvedTheme);

  /* 这里**不再**订阅视口缩放 —— 见 FlowNode / FrostLayer：
   *  只有磨砂（旁路 / 禁用）节点需要跟缩放。
   *
   *  父图上的子图卡片 —— 与 WorkflowNode 的两区布局对齐：
   *  紫色**头部**、一个把「纯连线输入端口（左圆点）」与「暴露的输出端口
   *  （右圆点）」按共享的 22px 行拉链式成对的**顶部 PINS 区**，
   *  以及一个把暴露的 widget 输入列成 LABEL | VALUE 行的 **WIDGET 区**
   *  （只有该 widget 槽**同时**接了线时才画圆点，与 WorkflowNode 的「both」
   *  行为一致）。紫色身份色与下钻入口是唯一子图特有的两处；
   *  IO 行用的是与普通节点**完全相同**的连接模型，接线方式因此保持统一。 */
  /* 子图身份色：默认紫色；封装节点自身被旁路时切成旁路粉（#ec4899），
   * 静音时切成灰色。与 WorkflowNode 的「模式 → 颜色」逻辑一致。 */
  const nodeMode = data.mode ?? 0;

  /*  子图封装节点与 WorkflowNode 一样，经 <NodeFrost> 用**真实**的
   *  `backdrop-filter` —— 按 1/缩放 反向缩放，避开 Chromium 在低缩放下的
   *  重复平铺伪影。<PseudoFrostLayer> 仍是不启用的兜底。 */
  const accent =
    nodeMode === 4 ? "#ec4899" : nodeMode === 2 ? "#6b7280" : "#7C5CFC"; // subgraph default purple identity (mode 0)

  /* 外框语义与 WorkflowNode 相同：导入的配置带显式尺寸时，
   *  根 div 被强制成 width/height: 100%（见下面的 `style` 块），
   *  卡片因此填满 React Flow 的节点框。多行文本框随之接入 flex 链，
   *  填满框内剩余的纵向空间，而不是被钉在一个固定的像素高度上。 */
  const hasSize = !!data.size;
  const inputsList = data.inputs ?? [];
  const outputsList = data.outputs ?? [];

  /* 用户可切换的折叠状态。与 WorkflowNode 一致：左侧的折叠箭头在
   *  「只有头部」与「完整主体」之间切换。
   *  `userCollapsed` 的初值取自导入的 `flags.collapsed`，
   *  这样一开始就折叠的子图仍能靠开关展开（与 WorkflowNode 同一个
   *  `true || 任何值` 的坑 —— 两者**不能**做或运算）。 */
  const [userCollapsed, setUserCollapsed] = useState<boolean>(
    data.flags?.collapsed === true,
  );
  const isCollapsed = userCollapsed;

  /* 过滤掉显示标签为空的那些行。
   *  ComfyUI 有时会在子图封装节点上导出哨兵 / 占位 IO ——
   *  例如 Settings.outputs[11] = `{name:"", type:"*", label:"PREVIEW"}`。
   *  没有这道过滤，画布会渲染出一行 22px 高的空行，
   *  用户会把它当成渲染 bug。 */
  /* 暴露口的显示名。wrapper 本层槽位名是 ComfyUI 自动编号的别名
   *  （`value_1`），业务名在内部真实字段上（proxyField，服务端由
   *  `properties.proxyWidgets` 解析）。先取内部字段的 label → localized →
   *  字段名，再回退本层 label/localized/别名——IO 面板用同一条链
   *  （见 workflow-detail-io 的富化），两处逐字一致。 */
  const exposedName = (inp: RawInputMeta): string =>
    sanitizeComboLabel(inp.proxyField?.label) ||
    sanitizeComboLabel(inp.proxyField?.localized) ||
    sanitizeComboLabel(inp.proxyField?.field) ||
    sanitizeComboLabel(inp.label) ||
    sanitizeComboLabel(inp.localized) ||
    inp.name ||
    "";

  const cleanedInputs = inputsList
    .map((inp) => ({ inp, label: exposedName(inp) }))
    .filter(({ label }) => label.trim().length > 0);

  const cleanedOutputs = outputsList
    .map((out) => ({
      out,
      display:
        sanitizeComboLabel(out.label) ||
        sanitizeComboLabel(out.localized) ||
        out.name ||
        "",
    }))
    .filter(({ display }) => display.trim().length > 0);

  /* 把封装节点的输入拆成 WorkflowNode 风格的两个桶：
   *   - connInputs   —— 纯类型端口（没有 widget 标记）。每个都有左边缘圆点
   *                    （常亮，未接线时也显示），并在顶部 PINS 区与输出成对。
   *                    若某个封装输入**同时**因上游接线带
   *                    `isConnection: true`，也归到这里（线是有落点的，
   *                    值来自上游）。
   *   - widgetInputs —— 被暴露的 widget 槽（带 widget 标记）。
   *                    在 WIDGET 区渲染成 LABEL | VALUE；只有该槽**同时**
   *                    接线（`isConnection` / `isBoundary`）时才画圆点，
   *                    与 WorkflowNode 的「both」行一致。
   *
   *  拆分判据从 `widgetValue` 改了过来（封装节点自己的 widgets_values
   *  从来不会填充那个字段，所以旧判据在封装节点上永不成立）。
   *     * `widgets_values[]` 是空的 —— ComfyUI 导出的封装节点不会把值内联进来），
   *     * 改成了按 `widget` 标记判（ComfyUI 导出的封装节点总是有它，
   *     * 服务端那一趟现在也会为自定义封装节点防御性地盖章）。
   *     * 与 WorkflowNode 的拆分器一致，把每个暴露的 widget 槽都归进 WIDGET 区，
   *     * LABEL | VALUE 行才能渲染成内联 widget。 */
  const connInputs = cleanedInputs.filter(
    ({ inp }) => !inp.widget && !inp.isConnection,
  );
  const widgetInputs = cleanedInputs.filter(
    ({ inp }) => !!inp.widget || inp.isConnection === true,
  );
  /* 顶部 PINS 行：每个声明的输入端口与每个输出端口各占一行，
   *  左右拉链式成对、行高 22px（与普通 WorkflowNode 相同）。 */
  const pinRows = Math.max(connInputs.length, cleanedOutputs.length);

  return (
    <div
      className={`relative flex flex-col rounded-lg border shadow-[0_6px_22px_var(--color-shadow-strong)] ${
        nodeMode !== 0 ? "bg-transparent" : "bg-node"
      }`}
      ref={hoverRef}
      data-node-id={data.nodeId}
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
        minHeight: isCollapsed
          ? NODE_TITLE_H
          : data.size
            ? (data.size.h ?? 0) + NODE_TITLE_H
            : undefined,
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
        outline: selected ? "2px solid rgba(56,189,248,0.9)" : "none",
        outlineOffset: selected ? "2px" : undefined,
      }}
    >
      {accent && nodeMode !== 0 && (
        <FrostLayer color={accent} nodeMode={nodeMode} />
      )}
      {/* 头部 —— 紫色强调（子图身份）。与普通 WorkflowNode 头部同一个
       *  NODE_TITLE_H，好让带标题的节点在网格上对齐。 */}
      <SubgraphHeader
        title={data.title}
        nodeId={String(data.nodeId)}
        accent={accent}
        isCollapsed={isCollapsed}
        onToggle={() => setUserCollapsed((value) => !value)}
        onEnter={data.onEnter}
        io={io}
        outputRef={
          cleanedOutputs.length > 0
            ? { name: cleanedOutputs[0]!.out.name }
            : null
        }
      />

      {/* 折叠态句柄锚点。子图章展开时隐藏 —— 那时
       *  改由下面的主体区块渲染。视觉上是同一根圆柱（圆角竖向
       *  药丸）：连线型边界输入在**左**一根，
       *  只要包裹声明了输出就在**右**一根。底下坐着
       *  不可见的每端口 <Handle>，让活连线几何
       *  在切换前后保持不变。
       *  折叠 / 展开都走这一套。 */}
      {isCollapsed &&
        (() => {
          const wiredInputs = connInputs.filter(({ inp }) =>
            data.connectedInputs?.has(inp.name),
          );
          const wiredOutputs = cleanedOutputs.filter(({ out }) =>
            data.connectedOutputs?.has(out.name),
          );
          const cylH = (count: number) => clamp(12 + count * 4, 16, 64);
          return (
            <>
              {wiredInputs.length > 0 && (
                <div
                  aria-hidden
                  className="pointer-events-none absolute"
                  style={{
                    left: -3,
                    top: "50%",
                    transform: "translateY(-50%)",
                    width: 6,
                    height: cylH(wiredInputs.length),
                    borderRadius: 999,
                    background: anchor.gradient,
                    border: anchor.border,
                    boxShadow: anchor.boxShadow,
                    zIndex: Z.base,
                  }}
                />
              )}
              {cleanedOutputs.length > 0 && (
                <div
                  aria-hidden
                  className="pointer-events-none absolute"
                  style={{
                    right: -3,
                    top: "50%",
                    transform: "translateY(-50%)",
                    width: 6,
                    height: cylH(cleanedOutputs.length),
                    borderRadius: 999,
                    background: anchor.gradient,
                    border: anchor.border,
                    boxShadow: anchor.boxShadow,
                    zIndex: Z.base,
                  }}
                />
              )}
              {wiredInputs.map(({ inp, label }, idx) => {
                const col = portColor(inp.type ?? "*");
                const total = wiredInputs.length;
                const offset = total > 1 ? (idx - (total - 1) / 2) * 6 : 0;
                return (
                  <Handle
                    key={`collapsed-sub-in-${inp.name}-${idx}`}
                    type="target"
                    position={Position.Left}
                    id={inp.name}
                    isConnectable={false}
                    className="!h-2 !w-2 !rounded-full"
                    style={{
                      left: 0,
                      top: `calc(50% + ${offset}px)`,
                      background: col,
                      opacity: 0,
                    }}
                    title={`${label} (${inp.type})`}
                  />
                );
              })}
              {wiredOutputs.map(({ out, display }, idx) => {
                const col = portColor(out.type ?? "*");
                const total = wiredOutputs.length;
                const offset = total > 1 ? (idx - (total - 1) / 2) * 6 : 0;
                return (
                  <Handle
                    key={`collapsed-sub-out-${out.name}-${idx}`}
                    type="source"
                    position={Position.Right}
                    id={`out:${out.name}`}
                    isConnectable={false}
                    className="!h-2 !w-2 !rounded-full"
                    style={{
                      right: 0,
                      top: `calc(50% + ${offset}px)`,
                      background: col,
                      opacity: 0,
                    }}
                    title={`${display} (${out.type})`}
                  />
                );
              })}
            </>
          );
        })()}

      {/* 顶部针脚区 —— 纯连接型输入端口（左圆点）与暴露出的
       *  输出端口（右圆点）拉在一行，与普通
       *  WorkflowNode 完全一致。每个声明过的针脚都常显
       *  圆点（always-on），未连线的端口也看得见。
       *  用户 / 配置把章标成折叠时隐藏。 */}
      {!isCollapsed && pinRows > 0 && (
        <div
          className="border-border-strong border-b py-0.5"
          style={{ background: "var(--color-subtle)" }}
        >
          {Array.from({ length: pinRows }).map((_, rowIdx) => {
            const inEntry = connInputs[rowIdx];
            const outEntry = cleanedOutputs[rowIdx];
            const inInp = inEntry?.inp;
            const outMeta = outEntry?.out;
            const inName = inInp?.name;
            const outName = outMeta?.name;
            const inType = inInp?.type ?? "*";
            const outType = outMeta?.type ?? "*";
            const inCol = portColor(inType);
            const outCol = portColor(outType);
            const inLabel = inEntry?.label ?? "";
            const outDisplay = outEntry?.display ?? "";
            return (
              <div
                key={`subpin-${rowIdx}-${inName ?? "_"}-${outName ?? "_"}`}
                /* 长的边界端口标签换行到
                 *                    *  多行换行，而不是被裁到 22px。完整理由见 WorkflowNode 内联分支
                 *                    *  的注释。 */
                className="relative flex h-auto min-h-[22px] items-center py-0.5 pr-5 pl-5 text-[11px]"
                data-sub-pin-input={inName}
                data-sub-pin-output={outName}
              >
                {inEntry && (
                  <>
                    <Handle
                      type="target"
                      position={Position.Left}
                      id={inName}
                      isConnectable={false}
                      className="!border-port-surface !h-2.5 !w-2.5 !rounded-full !border"
                      style={{
                        left: 5,
                        background: inCol,
                        boxShadow: `0 0 6px ${inCol}AA, inset 0 0 0 1px var(--color-port-surface)`,
                      }}
                      title={`${inLabel} (${inType})`}
                    />
                    {/* 已经从父工作流接进线来的子图边界输入（或本身
                     *  就是哨兵边界连线）取值来自上游 —— 它们
                     *  不能被暴露成工作流输入。已连线的槽位
                     *  跳过复选框。 */}
                    {io?.ioEditMode &&
                      inName &&
                      !inInp?.isConnection &&
                      !inInp?.isBoundary && (
                        <IoCheckbox
                          io={io}
                          ioRef={{
                            nodeId: String(data.nodeId),
                            hostNodeId: data.hostNodeId,
                            name: inName,
                            kind: "param",
                            direction: "input",
                          }}
                        />
                      )}
                    <span
                      /* 去掉 `truncate`：让长的边界端口标签
                       *  （例如 Settings 封装节点的 `Model: True = 🟡 Safetensors
                       *  | False = 🟣 GGUF` BOOLEAN widget）换成多行，
                       *  而不是被裁掉。完整文本仍能从原生 `title` tooltip 看到。 */
                      className="text-ink-bright min-w-0 flex-1 text-left text-[11px] break-words whitespace-normal"
                      title={`${inLabel} (${inType})`}
                    >
                      {inLabel}
                    </span>
                  </>
                )}
                {outEntry && (
                  <>
                    <span
                      /* 与上面边界输入分支同款换行修正。 */
                      className="text-ink-bright min-w-0 flex-1 text-right text-[11px] break-words whitespace-normal"
                      title={`${outDisplay} (${outType})`}
                    >
                      {outDisplay}
                    </span>
                    {/* 每端口输出复选框已移除；
                     *  工作流输出按节点标识。按节点的输出
                     *  复选框现在住在子图节点的头部。 */}
                    {/* 输出端点**任何视图模式下都必须挂载** —— 同
                     *  FlowNodePinRows：它同时是下游 `out:<name>` 边的锚点，
                     *  条件不渲染会让 React Flow 解析不到 handle 而丢掉整条边
                     *  （error#008），画布上表现为「输出没有连线」。
                     *  IO 编辑模式下改用「缩到几乎不可见」代替「不渲染」。 */}
                    <Handle
                      type="source"
                      position={Position.Right}
                      id={`out:${outName}`}
                      isConnectable={false}
                      className="!border-port-surface !rounded-full !border"
                      style={{
                        right: 5,
                        background: outCol,
                        boxShadow: `0 0 6px ${outCol}AA, inset 0 0 0 1px var(--color-port-surface)`,
                        ...(io?.ioEditMode
                          ? { width: 4, height: 4, opacity: 0.35, right: 0 }
                          : { width: 10, height: 10 }),
                      }}
                      title={`${outDisplay} (${outType})`}
                    />
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Widget 区 —— 暴露出的包裹 widget 输入，按 LABEL | VALUE 行排。
       *  只有槽位**同时**接了线（isConnection / isBoundary）才挂
       *  圆点（目标 Handle），与 WorkflowNode 的「两者都有」行一致。即便
       *  如此值也照常显示（连线不消失 + 值可见）。
       *  值很长的 STRING widget 拆成上下堆叠块。
       *  章折叠时隐藏。 */}
      {!isCollapsed && widgetInputs.length > 0 && (
        <div className="bg-surface-1 relative flex min-h-0 flex-1 flex-col py-0.5">
          {widgetInputs.map(({ inp, label }, i) => {
            const v: unknown = inp.widgetValue;
            const isConn = inp.isConnection === true || inp.isBoundary === true;
            const typeCol = portColor(inp.type);
            const stringText: string = typeof v === "string" ? v : "";
            /* 与 WorkflowNode 保持一致：STRING widget 的判定读服务端盖的
             *  `multiline`（来自节点类型声明
             *  `("STRING", {"multiline": true})`），再加上「值很长 / 含换行」
             *  这两条数据启发式 —— 不按字段名猜。 */
            const isStringWidget =
              !isConn &&
              inp.type === "STRING" &&
              (inp.multiline === true ||
                stringText.length >= 32 ||
                stringText.includes("\n"));
            const displayValue = isStringWidget
              ? ""
              : renderSubgraphWidgetValue(v);
            return (
              <div
                key={`sub-w-${inp.name}-${i}`}
                className={
                  isStringWidget
                    ? /* R17 (parity with WorkflowNode): vertical STACKED layout
                       *  for STRING widgets on the subgraph wrapper too.
                       *  LABEL + charCount chip on the top row, textarea
                       *  fills the remaining vertical space below.
                       *  Previous `flex-row items-start` (kept inline with
                       *  WorkflowNode) had the same title-and-value-
                       *  on-one-row + maxHeight-capped regression; see
                       *  the WorkflowNode branch comment for the full rationale. */
                      "group relative flex min-h-0 flex-1 flex-col gap-1.5 py-1.5 pr-2 pl-5 text-[11px]"
                    : /* long widget labels wrap onto
                       *  multiple lines instead of being clipped to 22 px.
                       *  See the WorkflowNode inline-branch comment for full
                       *  rationale. */
                      "group relative flex h-auto min-h-[22px] items-center gap-1.5 py-0.5 pr-2 pl-5 text-[11px]"
                }
                data-sub-widget-name={inp.name}
                data-sub-widget-value={String(v)}
              >
                {isConn && (
                  <Handle
                    type="target"
                    position={Position.Left}
                    id={inp.name}
                    isConnectable={false}
                    className="!border-port-surface !h-2.5 !w-2.5 !rounded-full !border"
                    style={{
                      left: 5,
                      background: typeCol,
                      boxShadow: `0 0 6px ${typeCol}AA, inset 0 0 0 1px var(--color-port-surface)`,
                    }}
                    title={`${label} (${inp.type})`}
                  />
                )}
                {/* 工作流输入必须是**未连线**的 —— 已经带线的槽位
                 *  （isConnection / isBoundary）取值来自上游，
                 *  把它暴露成工作流输入没有意义。 */}
                {/* 这个顶层复选框只服务**紧凑型**（非 STRING）widget。
                 *  STRING widget 在下面堆叠块内部
                 *  自己渲染 IoCheckbox，所以少了 `!isStringWidget`
                 *  守卫时，一行 STRING 会显示**两个**复选框 —— 一个孤零零飘在
                 *  行首，一个正确地挨着标签。 */}
                {io?.ioEditMode && !isConn && !isStringWidget && (
                  <IoCheckbox
                    io={io}
                    ioRef={{
                      nodeId: String(data.nodeId),
                      hostNodeId: data.hostNodeId,
                      name: inp.name,
                      kind: "widget",
                      direction: "input",
                    }}
                  />
                )}
                {!isStringWidget && (
                  <>
                    {inp.type === "COMBO" &&
                    Array.isArray((inp as ComboInputMeta).comboOptions) &&
                    ((inp as ComboInputMeta).comboOptions as unknown[]).length >
                      0 ? (
                      <>
                        <span
                          /* 去掉 `truncate`：让长的子图封装 COMBO widget 标签
                           *  换成多行而不是被裁掉（与 WorkflowNode 内联分支
                           *  同款修正）。 */
                          className="min-w-0 shrink text-left text-[11px] break-words whitespace-normal"
                          style={{
                            flex: "0 1 auto",
                            color: isConn
                              ? "var(--color-ink-strong)"
                              : "var(--color-ink-subtle)",
                          }}
                          title={label}
                        >
                          {label}
                        </span>
                        {/* 标签与取值之间的竖向 1px 分隔线。 */}
                        <span
                          className="bg-border-strong h-2 w-px shrink-0"
                          aria-hidden
                        />
                        {/* 工作流画布上的 COMBO widget 渲染成只读的
                         *  SelectMenu —— 它把当前选中的模型显示成下拉外壳，但
                         *  在这里保持禁用（编辑发生在会落盘取值的项目
                         *  画布表单里）。这个节点是忠实的只读预览，不是编辑器。
                         *  触发器压到 22px 行高，免得
                         *  破坏统一的针脚节奏。 */}
                        <SelectMenu
                          value={typeof v === "string" ? v : ""}
                          onChange={() => undefined}
                          options={
                            (inp as ComboInputMeta).comboOptions as string[]
                          }
                          disabled
                          /* `flex-1` 改的是**外层**的伸缩；触发器自身仍是内容宽，
                           *  宽度要铺满外层就得显式要 `fullWidth`（规范 03 §3.8.1.1）。 */
                          fullWidth
                          className="!h-[22px] min-w-0 !py-0 !text-[11px]"
                          popoverMinWidth={220}
                        />
                      </>
                    ) : (
                      <>
                        <span
                          /* 去掉 `truncate`：让长的子图封装 widget 标签换成多行
                           *  而不是被裁掉（与 WorkflowNode 内联分支同款修正）。 */
                          className="min-w-0 shrink text-left text-[11px] break-words whitespace-normal"
                          style={{
                            flex: "0 1 auto",
                            color: isConn
                              ? "var(--color-ink-strong)"
                              : "var(--color-ink-subtle)",
                          }}
                          title={label}
                        >
                          {label}
                        </span>
                        {/* 标签与取值之间的竖向 1px 分隔线。
                         *  现在是一段柔和竖向渐变（上下端
                         *  淡出到透明）而不是硬条 —— 读起来是
                         *  列提示，而不是「把行切成两半」的线。
                         *  宽度仍是 1px，不占行的版面。 */}
                        <span
                          className="bg-border-strong h-2 w-px shrink-0"
                          aria-hidden
                        />
                        <span
                          className="min-w-0 truncate text-right text-[10.5px] tabular-nums"
                          style={{
                            /* 与 WorkflowNode 的值 span 同理 —— `truncate` 回来了，
                             *  但只有文字本身缩略；节点宽度仍由用户控制
                             *  （ComfyUI 改尺寸 ↔ 画布镜像）。
                             *  不加 `minWidth: fit-content`
                             *  （长文件名会把它撑到 810px），
                             *  也不加 `maxWidth` 上限（会把本来就合法的宽节点裁掉）。 */
                            flex: "1 1 0",
                            color: valueCellColor(v),
                          }}
                          title={String(v)}
                        >
                          {displayValue}
                        </span>
                      </>
                    )}
                  </>
                )}
                {/* 子图包裹上的 STRING widget 文本框。**堆叠**
                 *  在 LABEL 行**下方**（与 WorkflowNode 对齐）。行是
                 *  `flex-col gap-1.5 flex-1`，好让标签 + 字数
                 *  章占住顶行、下面的 textarea 填满
                 *  剩下的竖向空间。`flex-row items-start` →
                 *  `flex-col gap-1.5 flex-1` 迁移与删掉
                 *  `maxHeight: 96` 的完整理由
                 *  见 WorkflowNode 分支。
                 *
                 *  与 WorkflowNode 分支配对：真正的 <textarea readOnly>
                 *  让多行提示自动换行，溢出部分原生滚动
                 *  （不依赖 Tailwind className —— WorkflowNode
                 *  子树历史上对任意值 className
                 *  编译不可靠）。子图包裹 widget 用 `mono` 字体
                 *  （它们通常是系统名 / ID）。值为空时
                 *  回落到淡淡的「（空）」占位，仍占住
                 *  flex-1 容器，行布局保持均衡。 */}
                {isStringWidget && (
                  <div className="flex min-h-0 flex-1 flex-col">
                    <div className="flex shrink-0 items-center gap-1.5">
                      {io?.ioEditMode && !isConn && (
                        <IoCheckbox
                          io={io}
                          ioRef={{
                            nodeId: String(data.nodeId),
                            hostNodeId: data.hostNodeId,
                            name: inp.name,
                            kind: "widget",
                            direction: "input",
                          }}
                        />
                      )}
                      <span
                        /* 子图 STRING 堆叠行的标签同样去掉 `truncate` ——
                         *  理由与 WorkflowNode 内联分支相同。 */
                        className="shrink-0 text-left text-[11px] break-words whitespace-normal"
                        style={{
                          color: isConn
                            ? "var(--color-ink-strong)"
                            : "var(--color-ink-subtle)",
                        }}
                        title={label}
                      >
                        {label}
                      </span>
                      <span
                        className="bg-border-strong h-2 w-px shrink-0"
                        aria-hidden
                      />
                      <span
                        className="text-ink-muted text-right text-[10px] tracking-wider uppercase"
                        title={`STRING · ${stringText.length} chars`}
                      >
                        {stringText.length}c
                      </span>
                    </div>
                    {stringText.length > 0 ? (
                      <StringTextarea
                        value={stringText}
                        mono
                        hasSize={hasSize}
                      />
                    ) : (
                      <div
                        className="border-border-strong bg-canvas-deep text-ink-fainter flex-1 rounded border px-2 py-1.5 text-[10.5px] leading-snug"
                        style={{ minHeight: 28 }}
                      >
                        （空）
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
});
