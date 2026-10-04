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
import type {
  WorkflowGroupData,
  WorkflowIoPortData,
  WorkflowNoteData,
} from "../workflow-types";
import { NODE_TITLE_H, lightenHex, hexToRgba, mixHex } from "../workflow-utils";
import { useCssColorToken } from "../hooks/use-css-color-token";

export const WorkflowGroupNode = React.memo(function WorkflowGroupNode({
  data,
}: {
  data: WorkflowGroupData;
}) {
  /* 标题现在是框内左上角的一个「页签」（原先浮在框**上方**的
   *  `top-[-16px]`，看着像脱了节，还和相邻便签的标题打架）。
   *  页签底色取分组色并压到 0.12 alpha，视觉上挂住它所属的框；
   *  主体填充降到 0.04，让内部节点仍是视觉焦点。
   *
   *  0.12 一开始被用户反馈「在画布上太淡」——「Step2 · Image size」页签
   *  与周围的线框几乎看不出对比、像透明的。页签因此抬到 0.30：
   *  清楚可读，又仍像一枚贴着框边的轻量「页签芯片」
   *  （WorkflowNote 那种 0.65 混色的整条标题栏会显得像另一张卡片）。
   *
   *  同一个问题随后又落到**框体**上：「红框处的背景也很透明」
   *  （分组内部右上角）。框体原本是 0.04，在暗色画布网格上实际不可见。
   *  抬到 0.12 后分组空间边界一眼可辨，但仍比 0.30 的页签轻 2.5 倍 ——
   *  标题保持视觉锚点，内部节点不被这层色淹掉。 */
  const fill = hexToRgba(data.color, 0.12);
  const border = hexToRgba(data.color, 0.55);
  const titleBg = hexToRgba(data.color, 0.3);
  const titleCol = lightenHex(data.color, 0.4);
  const draggable = !!data.draggable;
  return (
    <div
      className={
        "relative h-full w-full rounded-md " + (draggable ? "cursor-move" : "")
      }
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
/* ── IO 边界端口节点 ──
 * 给位于子图 INPUTS / OUTPUTS 边界上的节点（即输入由 -10 哨兵馈入、
 * 或输出被 -20 哨兵消费的节点）用的紧凑纯标签渲染。用户口径：
 * 这些边界节点要画成内层画布**左侧**（输入）/ **右侧**（输出）的小标签行 ——
 * 没有卡片外壳、没有标题栏、没有输出条 ——
 * 而不是现在「完整的 FlowNode 撒在画布上」那样。
 *
 * Visual contract:
 *   - 无背景卡片、无边框，只有标签文字 + handle 圆点。
 *   - 宽度约 110px（够放常见端口名；上限 200，
 *     免得一个 "thisIsAnExtremelyLongWrapperInputName" 把整列撑爆）。
 *   - INPUT 变体：handle 在**左**（哨兵 -10 的线从这里进）。
 *   - OUTPUT 变体：handle 在**右**（哨兵 -20 的线从这里出）。
 *   - 有值时值列用琥珀色 tabular-nums 渲染（封装输入的默认值，如 seed `41`），
 *     与参考截图里 "noise_seed  41  ▶" 那一行的样式一致。
 *   - `parentNodeTitle` 放在 `title` 属性里当 tooltip，
 *     用户悬停时仍能认出底下是哪个节点。 */
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
  const dotColor = data.type ? portColor(data.type) : "var(--color-ink-faint)";
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
  const hoverLabel = data.parentNodeTitle
    ? `${data.parentNodeTitle} · ${data.title}`
    : data.title;
  return (
    <div
      /* 输入面板的标签右对齐，名字紧贴右边的 handle 圆点（`noise_seed  ●`、
       *  `noise_seed 1  ●` 等），与用户给的参考图一致；输出面板保持左对齐，
       *  标签紧贴**左**边的 handle 圆点（`● noise_seed`）。
       *  React Flow 用 `Position` 属性把 Handle 绝对定位，
       *  所以改 flex 的 `justify-…` 只挪得动可见的标签 / 值 ——
       *  圆点始终钉在 wfGroup 的那一侧。 */
      className={`relative flex items-center ${isInput ? "justify-end" : "justify-start"} text-ink-bright/90 gap-1 px-1.5 py-0.25 text-[10.5px] leading-[1.4]`}
      style={{
        width: IO_PORT_WIDTH,
        background: "transparent",
        border: "none",
      }}
      title={`${hoverLabel}${data.type ? ` · ${data.type}` : ""}${valueStr ? ` · ${valueStr}` : ""}`}
    >
      {/* 边界针脚信号模型：
          针脚朝向画布*中心*，好让连线短而直。
          INPUT 针脚（"in"）把数据带**入**子图
         （React Flow `type="source"` —— 它供应内部节点的
          目标句柄），所以它的句柄坐在标签的**右**边缘
         （朝向中间列）。OUTPUT 针脚（"out"）接收
          从子图流出的数据（`type="target"`），所以它的
          句柄坐在标签的**左**边缘（同样朝向
          中间列）。"in" / "out" 这两个 id 保留，好让
          `buildEdges` 里的边能解析出稳定的句柄名。 */}
      {!isInput || isBoth ? (
        <Handle
          type="target"
          position={Position.Left}
          id="out"
          style={{ background: dotColor, left: -4 }}
        />
      ) : null}
      <span
        className="truncate font-medium"
        /* 边界 pin 标签上的「字距被拉开」问题：画布缩得很小时，
         *  浏览器默认的文字渲染会产生柔化的抗锯齿字形，看起来像字符之间有空隙
         *  （"s a m p l e s"）。`geometricPrecision` 加一点点负字距把字形收拢，
         *  任何缩放级别下都读作一个完整的词。
         *  字体族与 `font-medium` **刻意不动** —— 这一列只有 10.5px，
         *  500 字重正是合适的光学重量；渲染收拢之后再抬到 600 会显得过重。 */
        style={{
          maxWidth: IO_PORT_WIDTH - (valueStr ? 56 : 24),
          textRendering: "geometricPrecision",
          letterSpacing: "-0.01em",
        }}
      >
        {data.title}
      </span>
      {valueStr ? (
        <span className="text-warning-strong/90 text-3xs shrink-0 font-mono tabular-nums">
          {valueStr}
        </span>
      ) : null}
      {isInput || isBoth ? (
        <Handle
          type="source"
          position={Position.Right}
          id="in"
          style={{ background: dotColor, right: -4 }}
        />
      ) : null}
    </div>
  );
});
/* ── 便签 / MarkdownNote 注释节点 ──
 * ComfyUI 的便签 widget 上下叠着两部分：
 *   1. **标题栏** —— 一枚带小圆点图标的彩色芯片，标题取显式的 `title`
 *      属性，或正文第一行 `# 标题`。
 *   2. **主体** —— markdown 文本按便签宽度折行，配周围的底色。
 * 便签可拖动（整张节点就是拖拽把手），用户可以自由挪动注释；
 * markdown 主体仍能渲染链接与滚动，且在便签没覆盖到的地方不会挡住下面的图。 */
export const WorkflowNoteNode = React.memo(function WorkflowNoteNode({
  data,
}: {
  data: WorkflowNoteData;
}) {
  /* 便签背景是**全不透明**的 —— 把 `data.color` 烤进画布底色后的结果。
   *  底色很关键：若便签与画布共用同一底色，`#432` 这样的深色便签算出来的
   *  背景只比画布高约 12 个 RGB 单位 —— 便签在视觉上溶进背景，
   *  只剩 React Flow 的选中圈看得见。底色比画布**错开一档**，
   *  任意便签色都能保证约 25 个单位的对比，连最深的 `#432` 也轮廓清楚。
   *
   *  那一档就是 `--color-note-tint-base` token（浅色模式为白，暗色为 `#22222c`），
   *  跟主题走而不写死：对比论证在两种模式下都成立，浅色模式也不会再拿到一片深色。
   *  `data.color` 是用户给的内容色本身，不动。
   *
   *  低缩放下的可见性：像 DaSiWa Wan 2.2 这种宽工作流（130 个节点，
   *  fitView 后缩放落在约 0.15），便签的包围盒在屏幕上只有约 5~15px，
   *  1.5px 的实线边框在那里还不到一个像素。所以额外画一圈强外发光
   *  （boxShadow + 4px 环）—— 即使文字已经读不清，
   *  用户仍能按颜色环**数出**那 17 条便签；再加高 z-index
   *  让便签浮在普通节点之上，不被分组遮住。 */
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
          <span className="truncate" title={data.title}>
            Note: {data.title}
          </span>
        </div>
      )}
      <div
        className="wf-markdown text-2xs min-h-0 flex-1 overflow-auto p-2"
        style={{ color: "var(--color-ink-bright)", lineHeight: 1.5 }}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
});

/* ── 子图封装节点（ComfyUI 的扩展显示节点）──
 * ComfyUI 的子图实例序列化后 class_type === UUID，并带一组来自内部图
 * **暴露端口**（`proxyWidgets`）的合成输入。每个输入带一个 `localized_name`
 * 中文标签（如「正面提示词」）与一个英文 widget 名（如 "text"）。
 * 本组件把它们渲染成一枚紧凑的、类表单的节点，
 * 让用户不必展开子图就能看到里面有什么。 */
/* 节点类型注册表 = **工作流自身的图**：普通节点 / 备注 / 分组 / 子图封装 /
 *  子图边界口。这里**没有**「对外参数卡片」这一类：卡片会浮在图节点之上（`zIndex`
 *  比图节点高、贴着宿主节点左右各排一列）把工作流本身挡掉一片，且落点映射编辑
 *  已收敛到工作流库详情的「画布节点」页签（卡片列 + 连线层，见
 *  workflow-library/WorkflowParamCardColumn 与 WorkflowParamWires）。勾选 IO
 *  只写 workflowIO / paramMap，不再产生任何画布节点。 */
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
