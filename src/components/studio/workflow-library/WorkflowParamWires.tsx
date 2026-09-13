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
 * 自动判定出来的落点画虚线、作者改过的画实线，与编辑器画布同一套语义（见
 * workflow-editor/workflow-param-edges.ts）。
 */

import { useEffect, useRef, useState } from "react";

import { WIRE_PINS_ATTR, WIRE_ROW_ATTR } from "~/lib/workflow-io-types";
import { resolveDropTarget } from "~/lib/workflow-param-wiring";

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
 *  输出侧没有「落点」概念（输出不参与映射、不可改），所以这类线恒为只读呈现，
 *  也不参与拖拽起手判定。两处共用同一套量测与画线代码，就不会出现「输入侧的线
 *  收在圆心上、输出侧的线停在行边」这种漂移。 */
export type ParamWireKind = "paramToHost" | "hostToParam";

export interface ParamWire {
  /** 对外参数条目 id（卡片圆点锚点的一部分）。 */
  entryId: string;
  /** 落点的 ioKey（宿主表单行的 `data-io-key`）。
   *  `hostToParam` 线里它是**宿主输出行的 ioKey**（圆点挂 `data-port-dot`）。 */
  targetIoKey: string;
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
): { ioKey: string; rect: DOMRect }[] {
  const out: { ioKey: string; rect: DOMRect }[] = [];
  const precise = new Set<string>();
  for (const el of container.querySelectorAll<HTMLElement>(
    `[${PIN_ANCHOR_ATTR}], [${PORT_DOT_ATTR}]`,
  )) {
    const key =
      el.getAttribute(PIN_ANCHOR_ATTR) ?? el.getAttribute(PORT_DOT_ATTR);
    if (!key || precise.has(key)) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) continue;
    precise.add(key);
    out.push({ ioKey: key, rect });
  }
  for (const el of container.querySelectorAll<HTMLElement>(
    `[${WIRE_PINS_ATTR}], [${WIRE_ROW_ATTR}]`,
  )) {
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) continue;
    const pins = el.getAttribute(WIRE_PINS_ATTR);
    const keys = pins
      ? pins.split(",").filter(Boolean)
      : [el.getAttribute(WIRE_ROW_ATTR)].filter((key): key is string => !!key);
    for (const key of keys) {
      if (precise.has(key)) continue;
      out.push({ ioKey: key, rect });
    }
  }
  return out;
}

/** 一条线在 React 列表里的稳定 key。
 *
 *  必须是「条目 + 被接的那个端口」——一个对外参数默认可以**一对多**（「尺寸」的
 *  宽高比 / 像素量 / 倍数各一条线），只用条目 id 会让三条线共用同一个 key
 *  （React 重复 key，且点选高亮会张冠李戴）。 */
function wireKey(wire: ParamWire): string {
  return `${wire.entryId}?${wire.handleId}`;
}

/** 量出每条线两端的锚点，转成相对容器的坐标并给出贝塞尔路径。
 *
 *  起点 = 卡片那颗小圆点的**外侧边缘**（= 圆点锚点右沿 + 半颗圆点），与画布上
 *  React Flow 的连线起点口径一致：线从端点外缘出发，不会切进卡片里。
 *  终点 = 宿主那一行的圆点圆心（找不到圆点时退到行左沿中心）。 */
export function measureWires(
  container: HTMLElement,
  wires: readonly ParamWire[],
): Segment[] {
  const box = container.getBoundingClientRect();
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
      const a = hostDot.getBoundingClientRect();
      const b = cardDot.getBoundingClientRect();
      const x1 = a.left - box.left + a.width + a.width / 2;
      const y1 = a.top - box.top + a.height / 2;
      const x2 = b.left - box.left + b.width / 2;
      const y2 = b.top - box.top + b.height / 2;
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
      key: wireKey(wire),
      entryId: wire.entryId,
      manual: wire.manual,
      d: `M ${x1} ${y1} C ${x1 + dx} ${y1} ${x2 - dx} ${y2} ${x2} ${y2}`,
    });
  }
  return out;
}

/** 拖动中的预览线：起点 = 被拖的那颗圆点，终点 = 光标位置。
 *
 *  在**事件回调里**算好存进 state（而不是渲染期读 ref）：React 的 refs 规则
 *  禁止渲染期访问 ref，而这里既需要容器（ref 的 parentElement）又需要当前
 *  光标位置 —— 两者都只在事件发生那一刻是真的。 */
function dragPath(
  container: HTMLElement,
  entryId: string,
  handleId: string,
  point: { x: number; y: number } | null,
): string | null {
  const from = findAnchor(
    container,
    "data-wire-anchor",
    wireAnchorValue(entryId, handleId),
  );
  if (!from || !point) return null;
  const box = container.getBoundingClientRect();
  const a = from.getBoundingClientRect();
  const x1 = a.left - box.left + a.width + a.width / 2;
  const y1 = a.top - box.top + a.height / 2;
  const x2 = point.x - box.left;
  const y2 = point.y - box.top;
  const dx = Math.max(Math.abs(x2 - x1) / 2, 16);
  return `M ${x1} ${y1} C ${x1 + dx} ${y1} ${x2 - dx} ${y2} ${x2} ${y2}`;
}

export function WorkflowParamWires({
  wires,
  selectedEntryId = null,
  onSelect,
  onConnect,
  onDisconnect,
}: WorkflowParamWiresProps) {
  const ref = useRef<SVGSVGElement | null>(null);
  const [segments, setSegments] = useState<Segment[]>([]);
  /* 拖动中的预览线：起点 = 被拖的那颗圆点、终点 = 光标，路径在事件里算好。
   *  同时记下当前悬停命中的落点（有则预览线转实线，等于「松手会连到这里」）。 */
  const [drag, setDrag] = useState<{
    entryId: string;
    handleId: string;
    /** 已算好的预览线路径（量不到圆点时为空，不画）。 */
    path: string | null;
    /** 当前悬停命中的落点 ioKey（null = 没落在任何行上）。 */
    hover: string | null;
  } | null>(null);
  /* 空集合时**不挂线层**：挂载那一刻还没量过，`segments` 是空的，但 svg 必须先
   * 在 DOM 里才量得到锚点（量测的起点是 svg 的 parentElement）。所以「要不要
   * 渲染 svg」只取决于有没有线要画，而不是「已经量到几条」。 */
  const hasWires = wires.length > 0;
  /* 拖线手势要能起手，即使一条线都还没画（新连一条线时 wires 为空）——
   * 但只要有人在拖，图层就必须挂着（预览线画在这里）。 */
  const interactive = !!onConnect;
  const mounted = hasWires || !!drag || interactive;
  /* 依赖签名：线集合变了（换工作流 / 改模式 / 落点变化）就要重量一次。 */
  const signature = wires
    .map(
      (w) =>
        `${w.kind ?? "paramToHost"}>${w.entryId}>${w.handleId}>${w.targetIoKey}>${w.manual ? 1 : 0}`,
    )
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
  }, [signature, mounted]);

  /* ── 拖线手势 ──
   * 起手位是**卡片上的圆点**（`data-wire-anchor`），而圆点长在卡片列子树里、
   * 不在本层（本层只是叠在容器上的 SVG）。所以按下也必须在**文档级**监听，
   * 只受理真的落在圆点上的那一次：在 svg 上监听会一条线都拖不动。
   *
   * 移动 / 抬起同样在文档级：指针会移出线层（拖到宿主卡片上），绑在 svg 上
   * 中途就丢事件了。 */
  useEffect(() => {
    if (!onConnect) return;
    const down = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      const raw =
        target?.closest<HTMLElement>("[data-wire-anchor]")?.dataset.wireAnchor;
      if (!raw) return;
      const separator = raw.indexOf("?");
      if (separator < 0) return;
      const entryId = raw.slice(0, separator);
      const handleId = raw.slice(separator + 1);
      event.preventDefault();
      const container = ref.current?.parentElement;
      setDrag({
        entryId,
        handleId,
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
  }, [onConnect]);

  useEffect(() => {
    if (!drag) return;
    const container = ref.current?.parentElement;
    const move = (event: PointerEvent) => {
      const point = { x: event.clientX, y: event.clientY };
      const hover = container
        ? resolveDropTarget(point, collectDropTargets(container))
        : null;
      setDrag((prev) =>
        prev
          ? {
              ...prev,
              hover,
              path: container
                ? dragPath(container, prev.entryId, prev.handleId, point)
                : null,
            }
          : prev,
      );
    };
    const up = (event: PointerEvent) => {
      const point = { x: event.clientX, y: event.clientY };
      const hit = container
        ? resolveDropTarget(point, collectDropTargets(container))
        : null;
      if (hit) onConnect?.(drag.entryId, hit);
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
  }, [drag, onConnect]);

  /* 选中一条线后按 ⌫ / Delete = 在该模式下显式断开；Esc = 取消选中。
   *
   *  监听挂在**文档级**：线层整层不吃指针事件（见下方 svg 的说明），因此它拿不到
   *  键盘焦点 —— 挂在 svg 上这一条快捷键永远按不动。选中态本身是「点了某条线/
   *  某张卡」的结果，动作只对那个条目生效，挂在文档级不会误伤别处的输入。
   *
   *  焦点在输入框里时不拦截：用户在参数行里按退格是在删字，不是在断线。 */
  useEffect(() => {
    if (!selectedEntryId) return;
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
      if (!onDisconnect) return;
      if (event.key !== "Backspace" && event.key !== "Delete") return;
      event.preventDefault();
      onDisconnect(selectedEntryId);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [selectedEntryId, onDisconnect, onSelect]);

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
