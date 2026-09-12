"use client";

/* 工作流库「画布节点」预览里的**只读映射连线**。
 *
 * 对外参数卡片右侧的圆点端口与宿主卡片上被落到的那一行参数之间画一条线 ——
 * 这就是项目画布上那条映射线的静态版本：看线即可读出「提示词喂给了
 * positive_prompt」。卡片与宿主行各自带锚点（`data-wire-anchor` /
 * `data-io-key`），本组件在布局后量出两者的位置再叠一层 SVG。
 *
 * 为什么量位置而不是用固定坐标：卡片高度随端口行数变化（「尺寸」可能有多行、
 * 未连线时还要列出候选），宿主表单行的高度也随控件类型变化 —— 只有量出来的
 * 才是真的。量不到（元素还没挂上 / 行不在当前渲染里）就整条不画，不画悬空线。
 *
 * 自动判定出来的落点画虚线、作者改过的画实线，与编辑器画布同一套语义（见
 * workflow-editor/workflow-param-edges.ts）。
 */

import { useEffect, useRef, useState } from "react";

/** 自动判定落点的描边色（与编辑器画布一致）。 */
const AUTO_STROKE = "#64748b";
/** 作者改过的线的描边色。 */
const MANUAL_STROKE = "#a78bfa";

export interface ParamWire {
  /** 对外参数条目 id（卡片圆点的 `data-wire-anchor`）。 */
  entryId: string;
  /** 落点的 ioKey（宿主表单行的 `data-io-key`）。 */
  targetIoKey: string;
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

/** 量出每条线两端的锚点，转成相对容器的坐标并给出贝塞尔路径。 */
export function measureWires(
  container: HTMLElement,
  wires: readonly ParamWire[],
): Segment[] {
  const box = container.getBoundingClientRect();
  const out: Segment[] = [];
  for (const wire of wires) {
    const from = container.querySelector<HTMLElement>(
      `[data-wire-anchor="${cssEscape(wire.entryId)}"]`,
    );
    const to = container.querySelector<HTMLElement>(
      `[data-io-key="${cssEscape(wire.targetIoKey)}"]`,
    );
    /* 任一端不在（卡片没渲染 / 那一行不在当前表单里）→ 不画，避免悬空线头。 */
    if (!from || !to) continue;
    const a = from.getBoundingClientRect();
    const b = to.getBoundingClientRect();
    /* 起点 = 圆点**中心**（锚点就是那颗小圆点，量它的圆心才是线的落点）；
     * 终点 = 宿主行左沿中心（与画布上「输出端点 → 输入端点」的方向一致）。 */
    const x1 = a.left - box.left + a.width / 2;
    const y1 = a.top - box.top + a.height / 2;
    const x2 = b.left - box.left;
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

/** `CSS.escape` 在 jsdom / 老 WebView 上可能缺失，退回「只保留安全字符」。 */
function cssEscape(value: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function")
    return CSS.escape(value);
  return value.replace(/["\\\]]/g, "\\$&");
}

export function WorkflowParamWires({ wires }: WorkflowParamWiresProps) {
  const ref = useRef<SVGSVGElement | null>(null);
  const [segments, setSegments] = useState<Segment[]>([]);
  /* 依赖签名：线集合变了（换工作流 / 改模式 / 落点变化）就要重量一次。 */
  const signature = wires
    .map((w) => `${w.entryId}>${w.targetIoKey}>${w.manual ? 1 : 0}`)
    .join("|");

  useEffect(() => {
    const container = ref.current?.parentElement;
    if (!container) return;
    let frame = 0;
    const remeasure = () => {
      cancelAnimationFrame(frame);
      /* 等一帧：本组件可能与卡片同批挂载，立刻量会拿到前一次布局的位置。 */
      frame = requestAnimationFrame(() =>
        setSegments(measureWires(container, wires)),
      );
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

  if (segments.length === 0) return null;

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
