"use client";

/* 工作流库「画布节点」预览里的**只读映射连线**。
 *
 * 对外参数卡片右侧的圆点端口与宿主卡片上被落到的那一行参数之间画一条线 ——
 * 这就是项目画布上那条映射线的静态版本：看线即可读出「提示词喂给了
 * positive_prompt」。卡片与宿主行各自带锚点（`data-wire-anchor` / 宿主行与组合
 * 参数控件的两种落点锚点，见 `~/lib/workflow-io-types`），本组件在布局后量出
 * 两者的位置再叠一层 SVG。
 *
 * 为什么量位置而不是用固定坐标：卡片高度随端口行数变化（「尺寸」可能有多行、
 * 未连线时还要列出候选），宿主表单行的高度也随控件类型变化 —— 只有量出来的
 * 才是真的。量不到（元素还没挂上 / 行不在当前渲染里）就整条不画，不画悬空线。
 *
 * 自动判定出来的落点画虚线、作者改过的画实线，与编辑器画布同一套语义（见
 * workflow-editor/workflow-param-edges.ts）。
 */

import { useEffect, useRef, useState } from "react";

import { WIRE_PINS_ATTR, WIRE_ROW_ATTR } from "~/lib/workflow-io-types";

/** 端点圆点的数据属性（见 WorkflowPortHandle）—— 只读连线量圆心用。 */
const PORT_DOT_ATTR = "data-port-dot";
import { wireAnchorValue } from "./WorkflowParamCardColumn";

/** 自动判定落点的描边色（与编辑器画布一致）。 */
const AUTO_STROKE = "#64748b";
/** 作者改过的线的描边色。 */
const MANUAL_STROKE = "#a78bfa";

export interface ParamWire {
  /** 对外参数条目 id（卡片圆点锚点的一部分）。 */
  entryId: string;
  /** 落点的 ioKey（宿主表单行的 `data-io-key`）。 */
  targetIoKey: string;
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
}

interface Segment {
  key: string;
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

/** 量出每条线两端的锚点，转成相对容器的坐标并给出贝塞尔路径。
 *
 *  起点 = 卡片那颗小圆点的**外侧边缘**（= 圆点锚点右沿 + 半颗圆点），与画布上
 *  React Flow 的连线起点口径一致：线从端点外缘出发，不会切进卡片里。
 *  终点 = 宿主那一行的左沿中心。 */
export function measureWires(
  container: HTMLElement,
  wires: readonly ParamWire[],
): Segment[] {
  const box = container.getBoundingClientRect();
  const out: Segment[] = [];
  for (const wire of wires) {
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
    const a = from.getBoundingClientRect();
    const b = to.getBoundingClientRect();
    const x1 = a.left - box.left + a.width + a.width / 2;
    const y1 = a.top - box.top + a.height / 2;
    /* 圆点：终点取圆心（线正好收在点上）；退到整行时取左沿中线（线头停在行边）。 */
    const x2 = dot ? b.left - box.left + b.width / 2 : b.left - box.left;
    const y2 = b.top - box.top + b.height / 2;
    /* 水平间距的一半作控制点 —— 线从圆点平出、到宿主行平入，不会被卡片
     * 拐角切出尖角。间距为负（卡片与宿主卡片重叠）时控制点会反向，用
     * `Math.abs` 兜住，线仍是一条平滑的 S 形。 */
    const dx = Math.max(Math.abs(x2 - x1) / 2, 16);
    out.push({
      key: wire.entryId,
      manual: wire.manual,
      d: `M ${x1} ${y1} C ${x1 + dx} ${y1} ${x2 - dx} ${y2} ${x2} ${y2}`,
    });
  }
  return out;
}

export function WorkflowParamWires({ wires }: WorkflowParamWiresProps) {
  const ref = useRef<SVGSVGElement | null>(null);
  const [segments, setSegments] = useState<Segment[]>([]);
  /* 空集合时**不挂线层**：挂载那一刻还没量过，`segments` 是空的，但 svg 必须先
   * 在 DOM 里才量得到锚点（量测的起点是 svg 的 parentElement）。所以「要不要
   * 渲染 svg」只取决于有没有线要画，而不是「已经量到几条」。 */
  const hasWires = wires.length > 0;
  /* 依赖签名：线集合变了（换工作流 / 改模式 / 落点变化）就要重量一次。 */
  const signature = wires
    .map((w) => `${w.entryId}>${w.handleId}>${w.targetIoKey}>${w.manual ? 1 : 0}`)
    .join("|");

  useEffect(() => {
    const container = ref.current?.parentElement;
    if (!container) return;
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
  }, [signature]);

  /* 没有线要画就整层不渲染（也就不必量）。 */
  if (!hasWires) return null;

  return (
    <svg
      ref={ref}
      aria-hidden
      className="pointer-events-none absolute inset-0 h-full w-full overflow-visible"
      data-testid="wflib-param-wires"
    >
      {segments.map((segment) => (
        <path
          key={segment.key}
          d={segment.d}
          fill="none"
          stroke={segment.manual ? MANUAL_STROKE : AUTO_STROKE}
          strokeWidth={segment.manual ? 2.5 : 2}
          strokeDasharray={segment.manual ? undefined : "6 4"}
          opacity={segment.manual ? 1 : 0.75}
          data-testid={`wflib-param-wire-${segment.key}`}
        />
      ))}
    </svg>
  );
}
