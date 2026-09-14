"use client";

/* 工作流库「画布节点」预览里的**映射连线**（可编辑）。
 *
 * 对外参数卡片右侧的圆点端口与宿主卡片上被落到的那一行参数之间画一条线 ——
 * 这就是项目画布上那条映射线的库内版本：看线即可读出「提示词喂给了
 * positive_prompt」，拖线即可改落点。
 *
 * 库里这份连线是**可编辑**的（ISSUE #355：「连线要能编辑，现在编辑不了」）。
 * 编辑器画布上这件事由 React Flow 承担（端点即 <Handle>）；库里没有 React Flow
 * 上下文，因此手势在本层用指针事件等价实现：
 *
 *   · 从卡片圆点按下并拖动 → 拖出一条跟随光标的预览线；
 *   · 落在宿主落点上松开 → 写入 `paramMap.source.mode:<模式>`（= 改落点）；
 *   · 落在空白处松开 → 不改动任何映射（不留悬空线）；
 *   · 点击一条已有线 → 选中；按 ⌫ / Delete → 该对外参数在这个模式下显式断开。
 *
 * 命中解析用 `resolveDropTarget`（纯函数，与画布的闸门同一套判据 —— 同一个手势
 * 不该在两个界面一个受理、一个拒绝）。
 *
 * 为什么量位置而不是用固定坐标：卡片高度随端口行数变化（「尺寸」可能有多行），
 * 宿主表单行的高度也随控件类型变化 —— 只有量出来的才是真的。量不到就拿不到
 * 锚点，那条线不画（不留悬空线头）。
 *
 * 自动判定出来的落点画虚线、作者改过的画实线 —— 判据与落点解析同源
 * （`lib/workflow-param-mapping` 的 `resolveMapping` / `manualTargetForEntry`），
 * 不在这里另算一份。
 */

import { useEffect, useRef, useState } from "react";

import {
  WIRE_DIRECTION_ATTR,
  WIRE_PINS_ATTR,
  WIRE_ROW_ATTR,
} from "~/lib/workflow-io-types";
import {
  resolveDropTarget,
  type DOMRectLike,
} from "~/lib/workflow-param-wiring";

/** 端点圆点的数据属性（见 WorkflowPortHandle）—— 连线量圆心用。 */
const PORT_DOT_ATTR = "data-port-dot";
import { wireAnchorValue } from "./WorkflowParamCardColumn";

/** 自动判定落点的描边色（与编辑器画布一致）。 */
const AUTO_STROKE = "#64748b";
/** 作者改过的线的描边色。 */
const MANUAL_STROKE = "#a78bfa";
/** 拖动中的预览线描边色。 */
const DRAG_STROKE = "#c4b5fd";

/** 线的两端在哪一侧：
 *
 *  · `"paramToHost"`（默认）—— 对外**输入**参数卡片（左列）→ 宿主卡片参数行。
 *    这是映射线的常态：卡片圆点是起点，参数行/组合控件是终点，第 2 项起按
 *    「落点」判归属。
 *  · `"hostToParam"`—— 宿主卡片的输出行 → 对外**输出**参数卡片（右列）。
 *    方向相反：圆点在宿主行右侧、卡片在节点右边且圆点骑跨卡片**左**缘，
 *    线从宿主输出行出发向右收在卡片圆点上。
 *
 *  输出侧也能拖（ISSUE #355）：拖输出卡片左缘那颗圆点落到宿主卡片的另一行输出
 *  上，即改「这个输出口从哪一行取值」，落在它自己那一行则回到默认。两端共用同一
 *  套量测与画线代码，就不会出现「输入侧的线收在圆心上、输出侧的线停在行边」。 */
export type ParamWireKind = "paramToHost" | "hostToParam";

export interface ParamWire {
  /** 对外参数条目 id（卡片圆点锚点的一部分）。 */
  entryId: string;
  /** 落点的 ioKey（宿主表单行的 `data-io-key`）。
   *  `hostToParam` 线里它是**宿主输出行的 ioKey**（圆点挂 `data-port-dot`）。 */
  targetIoKey: string;
  /** 线的键空间。输出口与输入参数是两套不同的键（且输出口本身也是 workflowIO
   *  的键），同一个 id 在两侧可以同时存在 —— 不分开会让两条线在 React 列表里
   *  共用同一个 key（重复 key，点选高亮会张冠李戴）。 */
  namespace?: "param" | "output";
  /** 线的两端在哪一侧（缺省 = 输入侧）。 */
  kind?: ParamWireKind;
  /** 被连的**输出端口 handle id** —— 一个对外参数可能有多颗圆点（候选落点），
   *  线必须从被落到的那一颗出发，而不是「卡片上随便一颗」。 */
  handleId: string;
  /** 被连的端口落在**组合控件**上（宽/高、比例/像素这类没有独立行的端口），
   *  端点锚在整块控件上。 */
  grouped: boolean;
  /** 是否作者改过（实线）—— 否则是自动判定的默认线（虚线）。 */
  manual: boolean;
}

export interface WorkflowParamWiresProps {
  wires: readonly ParamWire[];
  /** 连线被点选时选出该条目（父级据此让卡片与线一起高亮）。 */
  selectedEntryId?: string | null;
  onSelect?: (entryId: string | null) => void;
  /** 落点写入（拖线落在某个宿主行上）。 */
  onConnect?: (entryId: string, ioKey: string) => void;
  /** 断开（选中一条线按 ⌫）。 */
  onDisconnect?: (entryId: string) => void;
  /** 输出侧落点写入（拖输出卡片的圆点落到某一**输出行**上）。
   *
   *  与输入侧分开传：输出的落点覆盖写在 `paramMap.output.mode:<模式>`，键空间与
   *  输入侧的 `source` 不同。上抛的是「这个输出口」与「它从哪一行取值」。 */
  onConnectOutput?: (outputIoKey: string, targetIoKey: string) => void;
  /** 输出侧断开（把某个输出口从它当前取值的那一行摘开）。 */
  onDisconnectOutput?: (outputIoKey: string) => void;
  /** 类型闸门（可选）：这个条目能不能落到这一行上（反向拖时第二个参数是**起手
   *  那一行**）。缺省 = 不做类型判定（只判几何命中）。
   *
   *  判据由上层给（`pinAcceptsEntry` + IO 表 + 契约 entries）：契约与 IO 的知识
   *  不进这个几何层，这里只保证「落不上的目标不会被画成可落点、也不会被上抛」。 */
  acceptsDrop?: (entryId: string, ioKey: string) => boolean;
}

interface Segment {
  key: string;
  entryId: string;
  manual: boolean;
  d: string;
}

/** 按属性**精确匹配**找锚点。
 *
 *  不能用 `querySelector(`[attr="${value}"]`)`：端口键（ioKey）里可能含
 *  `::`、引号乃至 CSS 特殊字符（端口名本身带分隔符是合法数据），拼进选择器
 *  要么语法出错、要么匹配到别的元素 —— 表现就是「线不画」。遍历 data 属性做
 *  字符串比较既准确又不必依赖 `CSS.escape`。 */
function findAnchor(
  container: HTMLElement,
  attr: string,
  value: string,
  separator = "",
): HTMLElement | null {
  const match = (el: Element): boolean => {
    const raw = el.getAttribute(attr);
    if (raw === null) return false;
    if (separator === "") return raw === value;
    return raw.split(separator).includes(value);
  };
  if (match(container)) return container;
  for (const el of container.querySelectorAll<HTMLElement>("*")) {
    if (match(el)) return el;
  }
  return null;
}

/** 落点锚点的值（`data-pin-anchor` = ioKey）—— 端口自己那一行上的零尺寸定位点
 *  （宿主表单的端口行 / 组合控件逐项参数各自带一枚）。 */
const PIN_ANCHOR_ATTR = "data-pin-anchor";

/** 行自己声明的 IO 方向（`data-io-direction`）—— 属性名收在
 *  `workflow-io-types`（与落点锚点同源），量测侧从同一处取。 */
const IO_DIRECTION_ATTR = WIRE_DIRECTION_ATTR;

/** 本轮渲染真的画出来的落点集合（ioKey → 量得到的矩形）。
 *
 *  拖线时用它做命中测试：只有画得出来的行才落得上去。
 *
 *  三种锚点的**优先级**很关键（`resolveDropTarget` 在都命中时取最小矩形，
 *  但这里还要保证「同一端口只报一处」）：
 *
 *   ① `data-pin-anchor` / `data-port-dot` —— 端口**自己那一行**上的定位点
 *      （12px）。同一个 ioKey 有它就不再收别的，否则组合控件那块大矩形会把
 *      同一端口的命中区域撑成整格，拖到哪一格都落在同一个口上。
 *   ② 组合控件一格的 `data-io-pins` —— 该格覆盖的端口各算一个可落点，
 *      取同一块矩形（那些端口没有自己的行时只能退到这一格）。 */
function collectDropTargets(
  container: HTMLElement,
  /** 只收「输出行」的锚点（拖输出卡片的圆点时传 true）。
   *
   *  输出的取值来源必须是工作流的**输出行**（`direction: "output"`），而不是
   *  输入参数行；把输入行也收进来的话，手势看似能落上去、写入却只能被拒绝 ——
   *  用户看到的就是「拖过去没反应」。判据取行自己声明的方向
   *  （`data-io-direction`），与 IO 表同源。 */
  outputsOnly = false,
): { ioKey: string; rect: DOMRectLike }[] {
  /* 坐标一律取**容器局部坐标**（除缩放），与拖动时的光标坐标同一口径（见
   *  `dragPath` 与 pointerup 的用法）—— 视口缩放下才判得准落点。 */
  const scale = wireScale(container);
  const out: { ioKey: string; rect: DOMRectLike }[] = [];
  const precise = new Set<string>();
  const isOutputAnchor = (el: Element): boolean =>
    el.getAttribute(IO_DIRECTION_ATTR) === "output";
  for (const el of container.querySelectorAll<HTMLElement>(
    `[${PIN_ANCHOR_ATTR}], [${PORT_DOT_ATTR}]`,
  )) {
    if (outputsOnly && !isOutputAnchor(el)) continue;
    const key =
      el.getAttribute(PIN_ANCHOR_ATTR) ?? el.getAttribute(PORT_DOT_ATTR);
    if (!key || precise.has(key)) continue;
    const box = rectInContainer(el, container, scale);
    if (box.width === 0 && box.height === 0) continue;
    precise.add(key);
    out.push({ ioKey: key, rect: toRectLike(box) });
  }
  for (const el of container.querySelectorAll<HTMLElement>(
    `[${WIRE_PINS_ATTR}], [${WIRE_ROW_ATTR}]`,
  )) {
    /* 输出的取值来源只可能是输出行：组合控件覆盖的都是输入口，直接跳过。 */
    if (outputsOnly && !isOutputAnchor(el)) continue;
    const box = rectInContainer(el, container, scale);
    if (box.width === 0 && box.height === 0) continue;
    const pins = el.getAttribute(WIRE_PINS_ATTR);
    const keys = pins
      ? pins.split(",").filter(Boolean)
      : [el.getAttribute(WIRE_ROW_ATTR)].filter((key): key is string => !!key);
    for (const key of keys) {
      if (precise.has(key)) continue;
      out.push({ ioKey: key, rect: toRectLike(box) });
    }
  }
  return out;
}

/** 命中测试只读矩形四边 —— 用一个轻量对象承载，避免为此构造 DOMRect。 */
function toRectLike(box: {
  left: number;
  top: number;
  width: number;
  height: number;
}): DOMRectLike {
  return {
    left: box.left,
    top: box.top,
    right: box.left + box.width,
    bottom: box.top + box.height,
    height: box.height,
  };
}

/** 一条线在 React 列表里的稳定 key。
 *
 *  必须是「条目 + 被接的那个端口」——一个对外参数默认可以**一对多**（「尺寸」的
 *  宽高比 / 像素量 / 倍数各一条线），只用条目 id 会让三条线共用同一个 key
 *  （React 重复 key，且点选高亮会张冠李戴）。 */
function wireKey(wire: ParamWire): string {
  /* 前缀把两套键空间分开：同一个 id 既可能是某个输入参数条目，也可能是某个
   *  输出口 —— 不分前缀时两条线会共用同一个 key（React 重复 key，点选高亮
   *  张冠李戴）。 */
  const ns = wire.namespace ?? (wire.kind === "hostToParam" ? "output" : "param");
  return `${ns}:${wire.entryId}?${wire.handleId}`;
}

/** 把**屏幕**坐标换算回「容器自己的坐标空间」所需的缩放。
 *
 *  **为什么必须带缩放**：库内画布是一个可缩放视口（`WorkflowCanvasViewportFrame`
 *  给内容层贴 `scale(z)`），而连线层是**绝对定位的 SVG**、坐标写在容器自己的
 *  坐标系里；`getBoundingClientRect()` 拿到的却是被祖先 scale 过的**屏幕**像素。
 *  两者混用 = 缩放不是 100% 时线按屏幕像素画、卡片按局部坐标摆放，线立刻与圆点
 *  错位（用户口径：「改了缩放，后线的位置错乱」ISSUE #355）。除以缩放后，无论
 *  视口缩到 35% 还是放到 200%，线都钉在圆点上。
 *
 *  **口径 = 容器自己的「屏幕尺寸 / 布局尺寸」之比**：`getBoundingClientRect()`
 *  给视觉（被祖先 transform 缩放过的）尺寸，`offsetWidth/Height` 给布局（未缩放）
 *  尺寸，两者的比值就是作用在这一层上的 CSS 缩放，与祖先层级怎么摆无关。
 *
 *  不能再拿「容器与其父级的 rect 之比」：连线层的容器（`relative w-fit`）与它的
 *  父级（视口内容层）**都在被缩放的那一层之内**，两个 rect 同比缩放、比值恒为 1
 *  —— 缩放永远测不出来，线按屏幕像素画在局部坐标系里，放大一倍就偏一倍
 *  （用户口径：「拖动的线直接飘向左侧」，ISSUE #355）。
 *
 *  平移（`translate`）不需要额外处理：它在锚点 rect 与容器 rect 的差值里自然
 *  抵消。 */
export function wireScale(container: HTMLElement): number {
  const rect = container.getBoundingClientRect();
  /* 布局尺寸取**两个方向里量得到的那个**：容器可能是一维放大的（`w-fit` 的横向
   *  宽、纵向由内容撑高），任一方向为 0 时另一个方向仍能给出缩放。 */
  const byWidth =
    container.offsetWidth > 0 ? rect.width / container.offsetWidth : 0;
  const byHeight =
    container.offsetHeight > 0 ? rect.height / container.offsetHeight : 0;
  const scale = byWidth > 0 ? byWidth : byHeight;
  /* 量不到（布局未就绪 / 单测里没钉尺寸）时按「没有缩放」处理：宁可线粗一点，
   *  也不把线按一个猜出来的倍率画到天边。 */
  return Number.isFinite(scale) && scale > 0 ? scale : 1;
}

/** 一个元素的矩形，换算到**容器自己的坐标空间**（左 / 上 / 宽 / 高）。
 *
 *  `scale` 由调用方按 `wireScale(container)` 现算并传进来（一次量测里只算一次）。
 *  这是「线钉在圆点上」的唯一坐标口径，量测的每一处都必须经过它。 */
export function rectInContainer(
  element: HTMLElement,
  container: HTMLElement,
  scale: number,
): { left: number; top: number; width: number; height: number } {
  const box = container.getBoundingClientRect();
  const rect = element.getBoundingClientRect();
  return {
    left: (rect.left - box.left) / scale,
    top: (rect.top - box.top) / scale,
    width: rect.width / scale,
    height: rect.height / scale,
  };
}

/** 锚点朝向**目标**的那一条边上的出线点（局部坐标）。
 *
 *  连线两端各挂在一颗 12px 的圆点上：线应当从圆点**背向卡片**的那一侧出去，
 *  而不是从圆心穿过去（穿圆心会让线头切进卡片里）。朝向由目标点决定 —— 目标在
 *  右侧就从圆点右缘出线，在左侧就从左缘出线。
 *
 *  为什么不能用写死的一侧：左列的对外参数卡片圆点骑跨卡片**右**缘（线向右去宿主
 *  行），右列的对外输出参数卡片圆点骑跨卡片**左**缘（线向左去宿主输出行）。写死
 *  「右缘 + 半颗点」在输出侧会把起点算到圆点右侧 18px 处 —— 拖动起点因此落在光标
 *  的另一侧，预览线看着「飘向左边」（ISSUE #355）。
 *
 *  同一侧时取外缘（不穿过圆心），另一侧时取另一外缘；水平间距为 0（两点同一列）
 *  时给圆心，线不会凭空横向折出一截。 */
function edgePointToward(
  box: { left: number; width: number; top: number; height: number },
  targetX: number,
): { x: number; y: number } {
  const centerX = box.left + box.width / 2;
  const y = box.top + box.height / 2;
  if (Math.abs(targetX - centerX) < 0.5) return { x: centerX, y };
  const x = targetX > centerX ? box.left + box.width : box.left;
  return { x, y };
}

/** 量出每条线两端的锚点，转成相对容器的坐标并给出贝塞尔路径。
 *
 *  两端各挂在 12px 的圆点上：起点取圆点**朝向终点**的那条外缘（见
 *  `edgePointToward`），与画布上 React Flow 的连线起点口径一致 —— 线从端点外缘
 *  出发，不会切进卡片里，也不会从圆点穿过去。
 *  终点 = 宿主那一行的圆点圆心（找不到圆点时退到行左沿中心）。
 *
 *  所有坐标都换算到容器的局部坐标系（见 `rectInContainer`）—— 视口缩放不改变
 *  线的落点。 */
export function measureWires(
  container: HTMLElement,
  wires: readonly ParamWire[],
): Segment[] {
  const scale = wireScale(container);
  const out: Segment[] = [];
  for (const wire of wires) {
    /* 输出侧的线方向相反：起点是**宿主卡片的输出行圆点**（`data-port-dot`），
     * 终点是**对外输出参数卡片上的圆点**（`data-wire-anchor`）。两者的量法
     * （起点取圆点外缘、终点取圆心）与输入侧共用下面同一段算式。 */
    if (wire.kind === "hostToParam") {
      const hostDot = findAnchor(container, PORT_DOT_ATTR, wire.targetIoKey);
      const cardDot = findAnchor(
        container,
        "data-wire-anchor",
        wireAnchorValue(wire.entryId, wire.handleId),
      );
      /* 任一端不在（输出行没渲染 / 卡片列没渲染）→ 不画，避免悬空线头。 */
      if (!hostDot || !cardDot) continue;
      const a = rectInContainer(hostDot, container, scale);
      const b = rectInContainer(cardDot, container, scale);
      /* 输出侧方向相反：宿主输出行圆点（左）→ 卡片圆点（右）。两端各取朝向
       *  对方的那一条外缘，线不会被圆点或卡片切进去。 */
      const from = edgePointToward(a, b.left + b.width / 2);
      const to = edgePointToward(b, a.left + a.width / 2);
      const x1 = from.x;
      const y1 = from.y;
      const x2 = to.x;
      const y2 = to.y;
      const dx = Math.max(Math.abs(x2 - x1) / 2, 16);
      out.push({
        key: wireKey(wire),
        entryId: wire.entryId,
        manual: wire.manual,
        d: `M ${x1} ${y1} C ${x1 + dx} ${y1} ${x2 - dx} ${y2} ${x2} ${y2}`,
      });
      continue;
    }
    /* 起点 = **被落到的那一颗圆点**：卡片上一个候选一颗点，按「条目 + 端口」
     *  精确定位，否则多候选口子（尺寸）会连到随便一颗上。 */
    const from = findAnchor(
      container,
      "data-wire-anchor",
      wireAnchorValue(wire.entryId, wire.handleId),
    );
    /* 终点 = 宿主那一行**端点圆点的圆心**（不是整行的左沿中线）。
     *
     *  折叠成逐行参数之后，一行是「标签行 + 控件行」两段结构，而圆点锁在标签行
     *  中线上；按整行 50% 量会把线画到圆心下方十几像素处 —— 用户看到的就是
     *  「线没有连接到端点上」（ISSUE #355）。组合控件那一格同理：它的锚点是整块
     *  控件，圆点（若有）仍按 `data-port-dot` 找得到。
     *
     *  找不到圆点（该行没渲染端点 / 只读预览里退化成了装饰点也带同一属性）时退到
     *  行左沿中线 —— 宁可粗一点，也不整条不画。 */
    const dot = findAnchor(container, PORT_DOT_ATTR, wire.targetIoKey);
    const row = wire.grouped
      ? (findAnchor(container, WIRE_PINS_ATTR, wire.targetIoKey, ",") ??
        findAnchor(container, WIRE_ROW_ATTR, wire.targetIoKey))
      : (findAnchor(container, WIRE_ROW_ATTR, wire.targetIoKey) ??
        findAnchor(container, WIRE_PINS_ATTR, wire.targetIoKey, ","));
    const to = dot ?? row;
    /* 任一端不在（卡片没渲染 / 那一行不在当前表单里）→ 不画，避免悬空线头。 */
    if (!from || !to) continue;
    const a = rectInContainer(from, container, scale);
    const b = rectInContainer(to, container, scale);
    /* 终点取哪一处：有圆点时取**圆心**（线正好收在点上），退到整行时取行左沿
     *  中线（线头停在行边）。先定终点的参考 x，起点再据此取朝向它的那条边。 */
    const endX = dot ? b.left + b.width / 2 : b.left;
    const endY = b.top + b.height / 2;
    const start = edgePointToward(a, endX);
    const x1 = start.x;
    const y1 = start.y;
    const x2 = endX;
    const y2 = endY;
    /* 水平间距的一半作控制点 —— 线从圆点平出、到宿主行平入，不会被卡片
     * 拐角切出尖角。间距为负（卡片与宿主卡片重叠）时控制点会反向，用
     * `Math.abs` 兜住，线仍是一条平滑的 S 形。 */
    const dx = Math.max(Math.abs(x2 - x1) / 2, 16);
    out.push({
      key: wireKey(wire),
      entryId: wire.entryId,
      manual: wire.manual,
      d: `M ${x1} ${y1} C ${x1 + dx} ${y1} ${x2 - dx} ${y2} ${x2} ${y2}`,
    });
  }
  return out;
}

/** 类型闸门判定（经 ref 取最新那一份；父层没给就只判几何命中）。 */
function allowed(
  ref: React.RefObject<((entryId: string, ioKey: string) => boolean) | undefined>,
  entryId: string,
  ioKey: string,
): boolean {
  return ref.current ? ref.current(entryId, ioKey) : true;
}

/** 卡片圆点声明的 `entryId?handleId` 里取出条目 id（输出口时就是该输出口的 ioKey）。 */
function entryIdOfAnchor(raw: string): string {
  const separator = raw.indexOf("?");
  return separator > 0 ? raw.slice(0, separator) : "";
}

/** 反向拖的可拖提示：行圆点按方向标十字光标。
 *
 *  行是表单层渲染的，这里用**命令式**盖一层装饰（与量测同源：都在本层遍历
 *  DOM）—— 不必把「可拖」这件事塞进表单层的 props，也不动它们的渲染结构。 */
function markDraggableDots(
  container: HTMLElement,
  input: boolean,
  output: boolean,
): void {
  for (const el of container.querySelectorAll<HTMLElement>(`[${PORT_DOT_ATTR}]`)) {
    const isOutput = el.getAttribute(IO_DIRECTION_ATTR) === "output";
    if (isOutput ? output : input) {
      el.dataset.wireSource = isOutput ? "output" : "input";
      el.style.cursor = "crosshair";
    } else if (el.dataset.wireSource) {
      delete el.dataset.wireSource;
      el.style.cursor = "";
    }
  }
}

/** 预览线路径：起点 = 给定锚点**朝向光标**的那条外缘，终点 = 光标。
 *
 *  两个方向共用这一段：卡片圆点起手（卡片 → 行）与行圆点起手（行 → 卡片）。 */
function pathFromAnchor(
  container: HTMLElement,
  anchor: HTMLElement,
  /** 光标位置，**屏幕坐标**（`clientX/clientY`）；局部坐标换算在本函数内做。 */
  point: { x: number; y: number },
): string {
  const scale = wireScale(container);
  const box = container.getBoundingClientRect();
  const a = rectInContainer(anchor, container, scale);
  /* 光标是**屏幕**坐标，同样要除缩放回到容器坐标系 —— 否则缩小时预览线
   *  会明显慢于/快于光标，「拖不准」。 */
  const x2 = (point.x - box.left) / scale;
  const y2 = (point.y - box.top) / scale;
  /* 起点取**朝向光标**的那条外缘：右列的输出卡片圆点骑跨卡片左缘，光标在它左边
   *  时线必须从左侧出线。写死右缘会把起点算到光标的另一侧 —— 用户看到的正是
   *  「往右拖，线却飘向左侧」（ISSUE #355）。 */
  const start = edgePointToward(a, x2);
  const dx = Math.max(Math.abs(x2 - start.x) / 2, 16);
  return `M ${start.x} ${start.y} C ${start.x + dx} ${start.y} ${x2 - dx} ${y2} ${x2} ${y2}`;
}

/** 反向拖（行 → 卡片）的可落点：两列对外参数卡片自己的圆点。
 *
 *  `outputs` 决定收哪一列 —— 从工作流**输出行**起手只能落到对外**输出**参数卡片
 *  （那些圆点带 `data-wire-kind="hostToParam"`），从**输入行**起手只能落到对外参数
 *  卡片；与「拖到行上」时的落点集合互为镜像。命中值就是圆点自己声明的
 *  `entryId?handleId`（与按下时解析卡片圆点用的是同一套键）。 */
export function collectCardTargets(
  container: HTMLElement,
  outputs: boolean,
): { ioKey: string; rect: DOMRectLike }[] {
  const scale = wireScale(container);
  const out: { ioKey: string; rect: DOMRectLike }[] = [];
  for (const el of container.querySelectorAll<HTMLElement>("[data-wire-anchor]")) {
    const raw = el.getAttribute("data-wire-anchor");
    if (!raw) continue;
    const isOutput = el.getAttribute("data-wire-kind") === "hostToParam";
    if (isOutput !== outputs) continue;
    const box = rectInContainer(el, container, scale);
    if (box.width === 0 && box.height === 0) continue;
    out.push({ ioKey: raw, rect: toRectLike(box) });
  }
  return out;
}

/** 拖动中的预览线：起点 = 被拖的那颗**卡片圆点**，终点 = 光标位置。
 *
 *  在**事件回调里**算好存进 state（而不是渲染期读 ref）：React 的 refs 规则
 *  禁止渲染期访问 ref，而这里既需要容器（ref 的 parentElement）又需要当前
 *  光标位置 —— 两者都只在事件发生那一刻是真的。 */
export function dragPath(
  container: HTMLElement,
  entryId: string,
  handleId: string,
  /** 光标位置，**屏幕坐标**（`clientX/clientY`）；局部坐标换算在本函数内做。
   *  两个调用点都必须传屏幕坐标 —— 传局部坐标会把容器偏移减两次，预览线飘向左上。 */
  point: { x: number; y: number } | null,
): string | null {
  const from = findAnchor(
    container,
    "data-wire-anchor",
    wireAnchorValue(entryId, handleId),
  );
  if (!from || !point) return null;
  return pathFromAnchor(container, from, point);
}

export function WorkflowParamWires({
  wires,
  selectedEntryId = null,
  onSelect,
  onConnect,
  onDisconnect,
  onConnectOutput,
  onDisconnectOutput,
  acceptsDrop,
}: WorkflowParamWiresProps) {
  const ref = useRef<SVGSVGElement | null>(null);
  const [segments, setSegments] = useState<Segment[]>([]);
  /* 拖动中的预览线：起点 = 被拖的那颗圆点、终点 = 光标，路径在事件里算好。
   *  同时记下当前悬停命中的落点（有则预览线转实线，等于「松手会连到这里」）。 */
  const [drag, setDrag] = useState<{
    entryId: string;
    handleId: string;
    /** 这一拖是「改输入落点」还是「改输出的取值行」—— 决定可落点集合与上抛回调。
     *  同一个手势在两列上语义不同，所以必须在这里分开记。 */
    kind: ParamWireKind;
    /** 已算好的预览线路径（量不到圆点时为空，不画）。 */
    path: string | null;
    /** 当前悬停命中的落点（null = 没落在任何目标上）：卡片起手时是行的 ioKey，
     *  行起手（反向）时是卡片圆点的 `entryId?handleId`。 */
    hover: string | null;
    /** **反向拖**（行 → 卡片）起手那一行的 ioKey；卡片起手时为空。
     *  给了它就表示：起点是这颗行圆点、落点是卡片圆点、上抛时行 ioKey 由它给。 */
    fromHostIoKey?: string;
  } | null>(null);
  /* 类型闸门由父层给（内联箭头，每次渲染都是新函数）：直接进事件 effect 的依赖
   *  会让监听器在拖动过程中反复解绑重绑，这里用 ref 同步最新那一份。 */
  const acceptsRef = useRef(acceptsDrop);
  useEffect(() => {
    acceptsRef.current = acceptsDrop;
  }, [acceptsDrop]);
  /* 空集合时**不挂线层**：挂载那一刻还没量过，`segments` 是空的，但 svg 必须先
   * 在 DOM 里才量得到锚点（量测的起点是 svg 的 parentElement）。所以「要不要
   * 渲染 svg」只取决于有没有线要画，而不是「已经量到几条」。 */
  const hasWires = wires.length > 0;
  /* 拖线手势要能起手，即使一条线都还没画（新连一条线时 wires 为空）——
   * 但只要有人在拖，图层就必须挂着（预览线画在这里）。 */
  const interactive = !!onConnect || !!onConnectOutput;
  const mounted = hasWires || !!drag || interactive;
  /* 依赖签名：线集合变了（换工作流 / 改模式 / 落点变化）就要重量一次。 */
  const signature = wires
    .map(
      (w) =>
        `${w.namespace ?? ""}>${w.kind ?? "paramToHost"}>${w.entryId}>${w.handleId}>${w.targetIoKey}>${w.manual ? 1 : 0}`,
    )
    .join("|");

  useEffect(() => {
    const container = ref.current?.parentElement;
    if (!container) return;
    /* 反向拖的可拖提示：有回调的方向上，行圆点标十字光标（见 markDraggableDots）。 */
    markDraggableDots(container, !!onConnect, !!onConnectOutput);
    let frame = 0;
    const remeasure = () => {
      cancelAnimationFrame(frame);
      /* 同步先量一次，再等一帧量一次：本组件可能与卡片同批挂载（那时量到的
       *  还是布局前的位置，需要下一帧的量修正），也可能挂载时布局已经就绪
       *  （头部卡片列先渲染、线层后挂载）—— 只等被取消的那一帧就会一条线都
       *  画不出来。两次都写同一份状态，内容不变时不触发重渲染。 */
      setSegments(measureWires(container, wires));
      frame = requestAnimationFrame(() => {
        frame = 0;
        setSegments(measureWires(container, wires));
      });
    };
    remeasure();
    /* 卡片高度随端口行数 / 宿主控件类型变化，尺寸一变就重量 —— 用
     * ResizeObserver 盯住容器，比手写依赖列表可靠。 */
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(() => remeasure());
    observer?.observe(container);
    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 线集合由 signature 表达
  }, [signature, mounted]);

  /* ── 拖线手势 ──
   * 起手位是**卡片上的圆点**（`data-wire-anchor`），而圆点长在卡片列子树里、
   * 不在本层（本层只是叠在容器上的 SVG）。所以按下也必须在**文档级**监听，
   * 只受理真的落在圆点上的那一次：在 svg 上监听会一条线都拖不动。
   *
   * 移动 / 抬起同样在文档级：指针会移出线层（拖到宿主卡片上），绑在 svg 上
   * 中途就丢事件了。 */
  useEffect(() => {
    if (!onConnect && !onConnectOutput) return;
    const down = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      const anchor = target?.closest<HTMLElement>("[data-wire-anchor]");
      const raw = anchor?.dataset.wireAnchor;
      if (!raw) {
        /* ── 反向：从工作流某一行**自己的圆点**起手（行 → 卡片）──
         *  原来只能「卡片圆点 → 工作流行」，从行上起手同样自然（用户盯着那一行
         *  想「这行喂给哪个对外参数 / 该输出口从哪一行取值」）。行圆点按**自己
         *  声明的方向**分流：输出行只能连到对外输出参数卡片，输入行只能连到对外
         *  参数卡片 —— 与拖到行上时的可落点集合互为镜像。 */
        const dot = target?.closest<HTMLElement>(`[${PORT_DOT_ATTR}]`);
        const ioKey = dot?.getAttribute(PORT_DOT_ATTR);
        if (!dot || !ioKey) return;
        const isOutput = dot.getAttribute(IO_DIRECTION_ATTR) === "output";
        if (isOutput ? !onConnectOutput : !onConnect) return;
        event.preventDefault();
        const hostContainer = ref.current?.parentElement;
        setDrag({
          /* 反向拖的 entryId 由落点（卡片圆点）决定，起手先空着；预览线与悬停
           *  都走 `fromHostIoKey` 那条分支。 */
          entryId: "",
          handleId: "",
          kind: isOutput ? "hostToParam" : "paramToHost",
          fromHostIoKey: ioKey,
          hover: null,
          path: hostContainer
            ? pathFromAnchor(hostContainer, dot, {
                x: event.clientX,
                y: event.clientY,
              })
            : null,
        });
        return;
      }
      const separator = raw.indexOf("?");
      if (separator < 0) return;
      const entryId = raw.slice(0, separator);
      const handleId = raw.slice(separator + 1);
      /* 圆点自己声明它属于哪一列（输入卡片的落点 / 输出卡片的取值行）——两列
       *  共用同一套手势与画线，语义在这里分流。没声明方向的（老视图）按输入侧
       *  处理。 */
      const kind: ParamWireKind =
        anchor.dataset.wireKind === "hostToParam" ? "hostToParam" : "paramToHost";
      /* 对应方向的落库回调没给 = 这一列不可编辑，按下不起手（不该拖的东西不要
       *  摆出能拖的样子）。 */
      if (kind === "hostToParam" ? !onConnectOutput : !onConnect) return;
      event.preventDefault();
      const container = ref.current?.parentElement;
      setDrag({
        entryId,
        handleId,
        kind,
        path: container
          ? dragPath(container, entryId, handleId, {
              x: event.clientX,
              y: event.clientY,
            })
          : null,
        hover: null,
      });
    };
    document.addEventListener("pointerdown", down);
    return () => document.removeEventListener("pointerdown", down);
  }, [onConnect, onConnectOutput]);

  useEffect(() => {
    if (!drag) return;
    const container = ref.current?.parentElement;
    /* 光标也换算到容器局部坐标：命中候选用的就是这套坐标（见 collectDropTargets），
     *  两边同口径，缩放视口下才判得准「松手会连到哪一行」。 */
    const localPoint = (event: PointerEvent) => {
      const box = container?.getBoundingClientRect();
      const scale = container ? wireScale(container) : 1;
      return {
        x: (event.clientX - (box?.left ?? 0)) / scale,
        y: (event.clientY - (box?.top ?? 0)) / scale,
      };
    };
    const outputsOnly = drag.kind === "hostToParam";
    const move = (event: PointerEvent) => {
      const point = localPoint(event);
      /* 反向拖的落点是卡片圆点，正向拖的落点是工作流行 —— 候选集合按起手处分流，
       *  再过一道类型闸门：落不上的目标不参与命中（不会点高亮、预览线也不转实线）。 */
      const fromHostKey = drag.fromHostIoKey ?? "";
      const targets = container
        ? fromHostKey
          ? collectCardTargets(container, outputsOnly).filter((target) =>
              allowed(acceptsRef, entryIdOfAnchor(target.ioKey), fromHostKey),
            )
          : collectDropTargets(container, outputsOnly).filter((target) =>
              allowed(acceptsRef, drag.entryId, target.ioKey),
            )
        : [];
      const hover = container ? resolveDropTarget(point, targets) : null;
      setDrag((prev) => {
        if (!prev) return prev;
        /* 预览线的终点要传**屏幕坐标**：`dragPath` / `pathFromAnchor` 自己减容器
         *  偏移、除缩放。这里若把已局部化的 `point` 传进去，偏移会被减两次，
         *  预览线固定飘到光标**左上方**（拖到哪都拐向左上，看着完全不跟手）；
         *  落点判定照旧用局部坐标 `point`，两者口径不同、别混。 */
        const screen = { x: event.clientX, y: event.clientY };
        /* 反向拖的起点是**起手那一行的圆点**（不是卡片圆点）：`drag.entryId` 在
         *  反向拖里是空的（entryId 由落点决定），只能按 `fromHostIoKey` 找回锚点。 */
        const fromHost = prev.fromHostIoKey
          ? findAnchor(container ?? document.body, PORT_DOT_ATTR, prev.fromHostIoKey)
          : null;
        return {
          ...prev,
          hover,
          path: !container
            ? null
            : prev.fromHostIoKey
              ? fromHost
                ? pathFromAnchor(container, fromHost, screen)
                : null
              : dragPath(container, prev.entryId, prev.handleId, screen),
        };
      });
    };
    const up = (event: PointerEvent) => {
      const point = localPoint(event);
      const fromHostKey = drag.fromHostIoKey ?? "";
      /* 与 move 同一套候选（含类型闸门）：松手时判不上的目标一律不上抛。 */
      const targets = container
        ? fromHostKey
          ? collectCardTargets(container, outputsOnly).filter((target) =>
              allowed(acceptsRef, entryIdOfAnchor(target.ioKey), fromHostKey),
            )
          : collectDropTargets(container, outputsOnly).filter((target) =>
              allowed(acceptsRef, drag.entryId, target.ioKey),
            )
        : [];
      const hit = container ? resolveDropTarget(point, targets) : null;
      if (hit && fromHostKey) {
        /* 反向拖：命中卡片圆点 → 让**起手那一行**成为这张口的落点。圆点自己声明
         *  `entryId?handleId`，条目 id 就是键（handleId 只用于在卡片上定位圆点）。 */
        const entryId = entryIdOfAnchor(hit);
        if (entryId) {
          if (drag.kind === "hostToParam") onConnectOutput?.(entryId, fromHostKey);
          else onConnect?.(entryId, fromHostKey);
        }
      } else if (hit) {
        if (drag.kind === "hostToParam") onConnectOutput?.(drag.entryId, hit);
        else onConnect?.(drag.entryId, hit);
      }
      setDrag(null);
    };
    const cancel = () => setDrag(null);
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", up);
    document.addEventListener("pointercancel", cancel);
    return () => {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", up);
      document.removeEventListener("pointercancel", cancel);
    };
  }, [drag, onConnect, onConnectOutput]);

  /* 选中一条线后按 ⌫ / Delete = 在该模式下显式断开；Esc = 取消选中。
   *
   *  监听挂在**文档级**：线层整层不吃指针事件（见下方 svg 的说明），因此它拿不到
   *  键盘焦点 —— 挂在 svg 上这一条快捷键永远按不动。选中态本身是「点了某条线/
   *  某张卡」的结果，动作只对那个条目生效，挂在文档级不会误伤别处的输入。
   *
   *  焦点在输入框里时不拦截：用户在参数行里按退格是在删字，不是在断线。 */
  useEffect(() => {
    if (!selectedEntryId) return;
    /* 选中的是右列的输出口还是左列的输入参数：两边的断开落在不同的键空间
     *  （`paramMap.output` vs `paramMap.source`），按有没有对应回调分流。 */
    const isOutputSelection = wires.some(
      (w) => w.namespace === "output" && w.entryId === selectedEntryId,
    );
    const disconnect = isOutputSelection ? onDisconnectOutput : onDisconnect;
    const onKeyDown = (event: KeyboardEvent) => {
      const active = document.activeElement;
      if (
        active instanceof HTMLElement &&
        (active.tagName === "INPUT" ||
          active.tagName === "TEXTAREA" ||
          active.isContentEditable)
      ) {
        return;
      }
      if (event.key === "Escape") {
        onSelect?.(null);
        return;
      }
      if (!disconnect) return;
      if (event.key !== "Backspace" && event.key !== "Delete") return;
      event.preventDefault();
      disconnect(selectedEntryId);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [selectedEntryId, onDisconnect, onDisconnectOutput, onSelect, wires]);

  if (!mounted) return null;

  return (
    <svg
      ref={ref}
      aria-hidden
      /* 线层整层**不吃指针事件**：它是叠在卡片列与宿主卡片之上的一层 SVG
       *  （`absolute inset-0`），保留命中会让它把下面所有交互都吞掉 —— 卡片
       *  右侧的圆点因此永远收不到 pointerdown（拖线一条都起不来），宿主卡片上
       *  的输入框也点不动。需要点的地方只有**线本身**：那一条 `path` 单独开
       *  `pointer-events: stroke`，用来点选后按 ⌫ 断开。
       *
       *  这也正是手势监听放在 document 上的原因：起手位（圆点）根本不在本层。 */
      className="pointer-events-none absolute inset-0 h-full w-full overflow-visible outline-none"
      data-testid="wflib-param-wires"
    >
      {segments.map((segment) => (
        <path
          key={segment.key}
          d={segment.d}
          fill="none"
          stroke={
            selectedEntryId === segment.entryId
              ? DRAG_STROKE
              : segment.manual
                ? MANUAL_STROKE
                : AUTO_STROKE
          }
          strokeWidth={segment.manual ? 2.5 : 2}
          strokeDasharray={segment.manual ? undefined : "6 4"}
          opacity={segment.manual ? 1 : 0.75}
          /* 线本身要能点选（选中后按 ⌫ 断开）——线层其余部分不吃指针事件，
           * 否则会盖住宿主卡片上的输入框。 */
          {...(interactive ? { pointerEvents: "stroke" as const } : {})}
          onClick={() => onSelect?.(segment.entryId)}
          data-testid={`wflib-param-wire-${segment.key}`}
        />
      ))}
      {drag?.path && (
        <path
          d={drag.path}
          fill="none"
          stroke={drag?.hover ? MANUAL_STROKE : DRAG_STROKE}
          strokeWidth={2}
          strokeDasharray={drag?.hover ? undefined : "4 4"}
          data-testid="wflib-param-wire-preview"
        />
      )}
    </svg>
  );
}
