"use client";
/* 工作流画布的节点渲染器与注册表：WorkflowGroupNode / WorkflowIoPortNode /
 * WorkflowNoteNode 及其共享常量、workflowNodeTypes / workflowEdgeTypes。 */
import React, { useMemo } from "react";
import { Handle, Position } from "@xyflow/react";
import { portColor } from "~/lib/comfyui/types";
import { renderMarkdown } from "~/lib/markdown";
import { WorkflowEdge } from "~/components/studio/canvas/WorkflowEdge";
import { FlowNode } from "../canvas/WorkflowNode";
import { WorkflowSubgraphNode } from "../canvas/WorkflowSubgraphNode";
import type { WorkflowGroupData, WorkflowIoPortData, WorkflowNoteData } from "../workflow-types";
import { NODE_TITLE_H, lightenHex, hexToRgba, mixHex } from "../workflow-utils";
import { useCssColorToken } from "../hooks/use-css-color-token";
import { Hint } from "~/components/ui/hint";

export const WorkflowGroupNode = React.memo(function WorkflowGroupNode({
  data,
}: {
  data: WorkflowGroupData;
}) {
  /* 标题是框内左上角的「页签」（原浮在框上方的 `top-[-16px]` 像脱节，还与相邻便签
   *  标题打架），底色取分组色：页签 0.30、框体 0.12。页签从 0.12 抬到 0.30 是因为
   *  用户反馈太淡（「Step2 · Image size」与线框几乎看不出对比）；框体从 0.04 抬到
   *  0.12 是因为「红框处背景也很透明」，0.04 在暗色网格上实际不可见。框体仍比页签
   *  轻 2.5 倍，标题保持视觉锚点，内部节点不被这层色淹掉。 */
  const fill = hexToRgba(data.color, 0.12);
  const border = hexToRgba(data.color, 0.55);
  const titleBg = hexToRgba(data.color, 0.3);
  const titleCol = lightenHex(data.color, 0.4);
  const draggable = data.draggable === true;
  return (
    <div
      className={`relative h-full w-full rounded-md ${draggable ? "cursor-move" : ""}`}
      style={{
        background: fill,
        border: `1.5px solid ${border}`,
        pointerEvents: draggable ? "auto" : "none",
      }}
    >
      {data.title ? (
        <div
          className="text-2xs absolute top-0 left-2 rounded-b px-1.5 py-0.25 leading-tight font-semibold"
          style={{
            color: titleCol,
            background: titleBg,
            /* 用 1px 的侧边 / 底部分隔线把标题页签「融」进框边：
             *  分隔线取边框色并压到 0.5 alpha —— 页签视觉上挂住了框，
             *  又不必再加一圈硬描边。 */
            boxShadow: `inset 0 -1px 0 ${hexToRgba(data.color, 0.5)}, inset -1px 0 0 ${hexToRgba(data.color, 0.5)}`,
          }}
        >
          {data.title}
        </div>
      ) : null}
    </div>
  );
});
/* ── IO 边界端口节点 ── 给子图 INPUTS / OUTPUTS 边界上的节点（输入由 -10 哨兵
 * 馈入、输出被 -20 哨兵消费）用的紧凑纯标签渲染：没有卡片外壳/标题栏/输出条，
 * 宽度约 110px（上限 200，免得超长端口名撑爆整列）；INPUT 的 handle 在左、OUTPUT
 * 在右；有值时值列用琥珀色 tabular-nums（如 seed `41`）；`parentNodeTitle` 放进
 * `title` 当 tooltip，悬停仍能认出底层节点。 */
export const IO_PORT_WIDTH = 160;
export const IO_PORT_HEIGHT = 28;
export const PORT_ROW_GAP = 4;
/** wfGroup 内、wfIoPort 列四周的水平内边距。
 *  避免标签文字贴死在紫色边框上。 */
export const GROUP_PAD_X = 10;
/** wfGroup 顶部的纵向内边距 —— 给 `top-[-16px]` 的标题芯片留出位置
 *  （它画在框上方，约占 18px）。 */
export const GROUP_TITLE_BAR = 24;
/** wfGroup 底部的纵向内边距。 */
export const GROUP_PAD_Y_BOTTOM = 10;
/** 包住边界 pin 的 INPUTS / OUTPUTS wfGroup 的边框与标题芯片颜色。
 *  用低饱和的紫色：分组框在画布上读得清，
 *  同时与内层的 FlowNode / WorkflowSubgraphNode 卡片区分得开。 */
export const GROUP_RAIL_COLOR = "#a855f7";

export const WorkflowIoPortNode = React.memo(function WorkflowIoPortNode({
  data,
}: {
  data: WorkflowIoPortData;
}) {
  const isInput = data.direction === "input";
  const isBoth = data.direction === "both";
  /* handle 圆点的颜色跟随端口类型，与画布其它地方的行圆点约定一致。
   * 类型缺失时回落到中性偏白的圆点。 */
  const dotColor =
    data.type !== undefined && data.type !== "" ? portColor(data.type) : "var(--color-ink-faint)";
  const rawValue = data.value;
  let valueStr: string | null = null;
  if (
    typeof rawValue === "string" ||
    typeof rawValue === "number" ||
    typeof rawValue === "boolean" ||
    typeof rawValue === "bigint"
  ) {
    valueStr = String(rawValue);
  } else if (rawValue !== null && rawValue !== undefined) {
    valueStr = JSON.stringify(rawValue);
  }
  /* 边界 pin 实体（definitions.subgraphs[uid].inputs/outputs）没有内部节点标题
   * —— 它们就是封装节点直接暴露出来的端口。此时 `parentNodeTitle` 是空串，
   * tooltip 就只剩端口标签 + 类型。 */
  const hoverLabel = data.parentNodeTitle ? `${data.parentNodeTitle} · ${data.title}` : data.title;
  return (
    <Hint
      label={`${hoverLabel}${data.type !== undefined && data.type !== "" ? ` · ${data.type}` : ""}${valueStr !== null && valueStr !== "" ? ` · ${valueStr}` : ""}`}
    >
      <div
        /* 输入面板标签右对齐、紧贴右边的 handle（`noise_seed  ●`），输出面板左对齐、
         *  紧贴**左**边的 handle（`● noise_seed`），与参考图一致。React Flow 用
         *  `Position` 把 Handle 绝对定位，改 flex 的 `justify-…` 只挪得动可见标签/值，
         *  圆点始终钉在 wfGroup 那一侧。 */
        className={`relative flex items-center ${isInput ? "justify-end" : "justify-start"} text-ink-bright/90 text-2xs gap-1 px-1.5 py-0.25 leading-[1.4]`}
        style={{
          width: IO_PORT_WIDTH,
          background: "transparent",
          border: "none",
        }}
      >
        {/* 边界针脚信号模型：针脚朝向画布**中心**，线才短而直。INPUT（"in"）把数据
          带**入**子图（React Flow `type="source"`，供应内部节点的目标句柄），句柄坐在
          标签**右**缘；OUTPUT（"out"）接收流出数据（`type="target"`），句柄在**左**缘。
          "in" / "out" 这两个 id 保留，`buildEdges` 靠它解析稳定的句柄名。 */}
        {!isInput || isBoth ? (
          <Handle
            id="out"
            position={Position.Left}
            style={{ background: dotColor, left: -4 }}
            type="target"
          />
        ) : null}
        <Hint label={data.title}>
          <span
            className="truncate font-medium"
            /* 边界 pin 标签的「字距被拉开」：画布缩得很小时浏览器默认文字渲染产生柔化
             *  抗锯齿，读成「s a m p l e s」。`geometricPrecision` + 一点负字距收拢字形。
             *  字体族与 `font-medium` **刻意不动**：这一列只有 11px，500 字重正是合适的
             *  光学重量，收拢后再抬到 600 会过重。 */
            style={{
              maxWidth: IO_PORT_WIDTH - (valueStr !== null && valueStr !== "" ? 56 : 24),
              textRendering: "geometricPrecision",
              letterSpacing: "-0.01em",
            }}
          >
            {data.title}
          </span>
        </Hint>
        {valueStr !== null && valueStr !== "" ? (
          <span className="text-warning-strong/90 text-3xs shrink-0 font-mono tabular-nums">
            {valueStr}
          </span>
        ) : null}
        {isInput || isBoth ? (
          <Handle
            id="in"
            position={Position.Right}
            style={{ background: dotColor, right: -4 }}
            type="source"
          />
        ) : null}
      </div>
    </Hint>
  );
});
/* ── 便签 / MarkdownNote 注释节点 ── ComfyUI 便签叠着两部分：① 标题栏 —— 带小圆点
 * 图标的彩色芯片，标题取显式 `title` 或正文首行 `# 标题`；② 主体 —— markdown 按
 * 便签宽度折行 + 周围底色。整张节点即拖拽把手，用户可自由挪动注释；markdown 仍能
 * 渲染链接与滚动，且不挡下面的图。 */
export const WorkflowNoteNode = React.memo(function WorkflowNoteNode({
  data,
}: {
  data: WorkflowNoteData;
}) {
  /* 便签背景是**全不透明**的：把 `data.color` 烤进 `--color-note-tint-base`（浅色白、
   *  暗色 `#22222c`），底色比画布错开一档。共用画布底色时 `#432` 只高约 12 个 RGB
   *  单位，便签溶进背景；错开一档后任意便签色都有约 25 单位对比。`data.color` 是用户
   *  给的内容色，不动。低缩放下（DaSiWa 130 节点 fitView ≈0.15，便签只有 5~15px）再
   *  画 4px 强外发光并抬 z-index：文字读不清时仍能按色环数出 17 条便签。 */
  const noteTintBase = useCssColorToken("--color-note-tint-base", "#ffffff");
  const bg = mixHex(noteTintBase, data.color, 0.2);
  const border = mixHex(noteTintBase, data.color, 0.65);
  const titleBg = mixHex(noteTintBase, data.color, 0.65);
  const titleText = lightenHex(data.color, 0.7);
  /* 每次渲染只跑一遍正文 markdown。该渲染器是 XSS 安全的：解析交给 marked，
   *  产物过 DOMPurify 白名单（含 URL 协议白名单），见 `~/lib/markdown`。 */
  const html = useMemo(() => renderMarkdown(data.text), [data.text]);
  return (
    <div
      className="z-base relative flex h-full w-full cursor-move flex-col overflow-hidden rounded-md"
      style={{
        background: bg,
        border: `2.5px solid ${border}`,
        boxShadow:
          `0 0 0 4px ${border}55, ` /* 33 % alpha outer ring */ +
          `0 0 14px 2px ${border}33, ` /* soft colour glow */ +
          `0 8px 18px var(--color-shadow-strong)` /* drop shadow */,
      }}
    >
      {data.title && (
        /* 与 FlowNode / WorkflowSubgraphNode 用同一个 NODE_TITLE_H。
         *  包装节点的 React Flow 高度已经在原始 `size[1]` 主体框之上加了这条
         *  标题栏（见 noteNodes 构建器），因此在这里把高度钉死，
         *  markdown 主体才会正好停在作者设定的尺寸上，
         *  而不是少掉一整条标题栏的高度。 */
        <div
          className="flex shrink-0 items-center gap-1.5 px-2.5 text-[11.5px] leading-tight font-bold"
          style={{
            height: NODE_TITLE_H,
            background: titleBg,
            borderBottom: `1.5px solid ${border}`,
            color: titleText,
            textShadow: `0 0 6px ${titleText}66`,
          }}
        >
          <span
            className="inline-block size-2 shrink-0 rounded-full"
            style={{ background: titleText, boxShadow: `0 0 6px ${titleText}` }}
          />
          <Hint label={data.title}>
            <span className="truncate">Note: {data.title}</span>
          </Hint>
        </div>
      )}
      <div
        className="wf-markdown text-2xs min-h-0 flex-1 overflow-auto p-2"
        dangerouslySetInnerHTML={{ __html: html }}
        style={{ color: "var(--color-ink-bright)", lineHeight: 1.5 }}
      />
    </div>
  );
});

/* ── 子图封装节点（ComfyUI 扩展显示节点）── 子图实例序列化后 class_type === UUID，
 * 并带一组来自内部图**暴露端口**（`proxyWidgets`）的合成输入，每个输入有
 * `localized_name` 中文标签（如「正面提示词」）与英文 widget 名（如 "text"）。
 * 本组件渲染成紧凑的类表单节点，不必展开子图就能看到里面有什么。 */
/* 节点类型注册表 = **工作流自身的图**：普通节点 / 备注 / 分组 / 子图封装 / 子图边界
 *  口。这里**没有**「对外参数卡片」：卡片会浮在图节点之上遮掉一片，且落点映射编辑已
 *  收敛到库详情「画布节点」页签（见 workflow-library/WorkflowParamCardColumn 与
 *  WorkflowParamWires）。勾选 IO 只写 workflowIO / paramMap，不产生画布节点。 */
export const workflowNodeTypes = {
  wfNode: FlowNode,
  wfNote: WorkflowNoteNode,
  wfGroup: WorkflowGroupNode,
  wfSubgraph: WorkflowSubgraphNode,
  wfIoPort: WorkflowIoPortNode,
};
// 自定义边渲染器 —— 更圆的贝塞尔（曲率 0.85）+ ComfyUI 风格的
// 曲线中点白心圆点。定义在模块作用域，React Flow 就不会每次渲染都
// 重新注册 edgeTypes。
export const workflowEdgeTypes = { default: WorkflowEdge };
