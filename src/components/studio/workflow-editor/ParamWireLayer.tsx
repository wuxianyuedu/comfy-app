"use client";

/* ── 对外参数 → 节点端口的连线（映射图）──
 *
 * 工作流编辑器把「对外暴露的参数」当作画布上的一列源节点（由 ParamSourceRail
 * 通过 Portal 渲染成真实 DOM，使 React Flow 能从它的句柄拖出连线），目标端口
 * 则是节点卡片上的一行（多数未连线，因此没有 React Flow Handle，无法原生锚定）。
 *
 * 所以映射的可视化分两层：
 *   · 源侧 —— ParamSourceRail 里的真实节点（可拖动、可拖线）；
 *   · 目标侧 + 连线 —— 本文件自绘 SVG：用 React Flow 的节点 DOM
 *     （data-id / data-pin-input）在**视口坐标**里量出端点，再画贝塞尔曲线。
 *     订阅 state.transform，所以平移/缩放时曲线跟随重建。
 *
 * 这样既保住了「从对外参数拖到端口」的原生交互，又不用让每个普通端口都挂 Handle
 * （那会让整张图多出成百上千个交互节点，违背画布的按视口渲染优化）。 */

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useStore } from "@xyflow/react";

/** 一条映射连线。`targetSlot` 为空 = 该对外参数未连线。 */
export interface ParamWire {
  /** 对外参数条目 id（= 源节点 id）。 */
  sourceId: string;
  sourceNodeId: string;
  sourceLabel: string;
  /** 目标节点 id（工作流图节点）。 */
  targetNodeId: string;
  /** 目标端口名（节点输入行）。 */
  targetSlot: string | null;
  manual: boolean;
  color: string;
}

/** 端点（视口坐标）。 */
interface Point {
  x: number;
  y: number;
}

/** 量一个源节点的右中句柄（视口坐标）—— 源节点由 ParamSourceRail 渲染，
 *  带 `data-param-source="<id>"` 根属性与 `data-param-handle` 句柄。 */
function measureSource(id: string): Point | null {
  const el = document.querySelector<HTMLElement>(`[data-param-source="${CSS.escape(id)}"]`);
  if (!el) return null;
  const handle = el.querySelector<HTMLElement>("[data-param-handle]") ?? el;
  const rect = handle.getBoundingClientRect();
  return { x: rect.right, y: rect.top + rect.height / 2 };
}

/** 量一个目标端口行的左中锚点（视口坐标）。
 *  优先认节点本体上的 `data-pin-input`（端口行自带的标记），其次退回卡片
 *  底部——节点折叠 / 端口未渲染时仍能画出一条指向该节点的线。 */
function measureTarget(nodeId: string, slot: string | null): Point | null {
  if (!slot) return null;
  const node = document.querySelector<HTMLElement>(`.react-flow__node[data-id="${CSS.escape(nodeId)}"]`);
  if (!node) return null;
  const row =
    node.querySelector<HTMLElement>(`[data-pin-input="${CSS.escape(slot)}"]`) ??
    node.querySelector<HTMLElement>(`[data-input-key="${CSS.escape(slot)}"]`);
  const rect = (row ?? node).getBoundingClientRect();
  return { x: rect.left, y: rect.top + rect.height / 2 };
}

const WIRE_COLOR_MANUAL = "#fbbf24";
const WIRE_COLOR_AUTO = "#8b5cf6";

export function ParamWireLayer({
  wires,
  activeId,
  onPick,
}: {
  wires: ParamWire[];
  activeId?: string | null;
  onPick?: (id: string) => void;
}) {
  const transform = useStore((state) => state.transform);
  const [tick, setTick] = useState(0);

  /* 端点来自被 React Flow 变换过的 DOM 盒子，量一次就够；节点增删 / 视口变化 /
   * 端口行重排后重新量。rAF 合并同一帧内的多次触发，避免拖拽时反复 layout。 */
  useEffect(() => {
    let frame = 0;
    const schedule = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        setTick((n) => n + 1);
      });
    };
    schedule();
    window.addEventListener("resize", schedule);
    /* 节点卡片是异步测量 + 折叠展开的，头几帧量不到就补量几次。 */
    const timers = [50, 150, 400].map((ms) => window.setTimeout(schedule, ms));
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener("resize", schedule);
      timers.forEach((t) => window.clearTimeout(t));
    };
  }, [transform, wires]);

  const paths = useMemo(() => {
    void tick;
    const out: {
      wire: ParamWire;
      from: Point;
      to: Point;
      d: string;
    }[] = [];
    for (const wire of wires) {
      const from = measureSource(wire.sourceId);
      const to = measureTarget(wire.targetNodeId, wire.targetSlot);
      if (!from || !to) continue;
      /* 三次贝塞尔：横向控制点让曲线离开源节点后先水平走一段，与画布上
       * 「线从左到右」的视觉语言一致。 */
      const dx = Math.max(48, Math.abs(to.x - from.x) * 0.45);
      const d = `M ${from.x} ${from.y} C ${from.x + dx} ${from.y}, ${to.x - dx} ${to.y}, ${to.x} ${to.y}`;
      out.push({ wire, from, to, d });
    }
    return out;
  }, [wires, tick]);

  if (!paths.length) return null;

  return (
    <svg
      className="pointer-events-none absolute inset-0 z-[3] h-full w-full"
      aria-hidden
    >
      {paths.map(({ wire, to, d }) => {
        const color = wire.manual ? WIRE_COLOR_MANUAL : WIRE_COLOR_AUTO;
        const active = activeId === wire.sourceId;
        return (
          <g key={`${wire.sourceId}-${wire.targetNodeId}-${wire.targetSlot ?? "_"}`}>
            <path
              d={d}
              fill="none"
              stroke={color}
              strokeWidth={active ? 2.5 : 1.6}
              strokeOpacity={active ? 0.95 : 0.55}
              strokeDasharray={wire.manual ? undefined : "5 4"}
            />
            <circle
              cx={to.x}
              cy={to.y}
              r={active ? 4 : 3}
              fill={color}
              fillOpacity={active ? 1 : 0.8}
              className={onPick ? "pointer-events-auto cursor-pointer" : undefined}
              onClick={() => onPick?.(wire.sourceId)}
            />
          </g>
        );
      })}
    </svg>
  );
}

/* ── 源节点（可拖动、可从其句柄拖出连线）──
 * 用 Portal 挂进 React Flow 的视口容器，因此天然跟随平移 / 缩放；位置由用户
 * 拖拽决定（存 localStorage，避免每次打开都回到默认位置）。 */
export function ParamSourceRail({
  wires,
  portalTarget,
  activeId,
  onPick,
  onConnect,
}: {
  wires: ParamWire[];
  portalTarget: HTMLElement | null;
  activeId: string | null;
  onPick: (id: string) => void;
  onConnect: (id: string, targetNodeId: string, slot: string) => void;
}) {
  if (!portalTarget) return null;
  return createPortal(
    <>
      {wires.map((wire, index) => (
        <ParamSourceNode
          key={wire.sourceId}
          wire={wire}
          index={index}
          active={activeId === wire.sourceId}
          onPick={onPick}
          onConnect={onConnect}
        />
      ))}
    </>,
    portalTarget
  );
}

const RAIL_ORIGIN = { x: 40, y: 120 };

function ParamSourceNode({
  wire,
  index,
  active,
  onPick,
  onConnect,
}: {
  wire: ParamWire;
  index: number;
  active: boolean;
  onPick: (id: string) => void;
  onConnect: (id: string, targetNodeId: string, slot: string) => void;
}) {
  /* 位置：用户拖过的记 localStorage（工作流无关，同一屏上一列到底），
   * 没拖过则按序号纵向排开。 */
  const storageKey = `wf-param-node:${wire.sourceId}`;
  const [pos, setPos] = useState<{ x: number; y: number }>(() => {
    if (typeof window === "undefined") {
      return { x: RAIL_ORIGIN.x, y: RAIL_ORIGIN.y + index * 34 };
    }
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (raw) {
        const parsed: unknown = JSON.parse(raw);
        if (
          parsed &&
          typeof parsed === "object" &&
          typeof (parsed as { x?: unknown }).x === "number" &&
          typeof (parsed as { y?: unknown }).y === "number"
        ) {
          return parsed as { x: number; y: number };
        }
      }
    } catch {
      /* 读取失败（隐私模式 / 配额）→ 用默认位置 */
    }
    return { x: RAIL_ORIGIN.x, y: RAIL_ORIGIN.y + index * 34 };
  });
  const dragRef = useRef<{ dx: number; dy: number } | null>(null);

  const color = wire.manual ? WIRE_COLOR_MANUAL : "#8b5cf6";

  return (
    <div
      data-param-source={wire.sourceId}
      className={`react-flow__node absolute flex h-[26px] w-[168px] cursor-grab items-center gap-1.5 rounded-md border px-2 text-[11px] ${
        active
          ? "border-violet-400/80 bg-violet-500/25 text-violet-50"
          : "border-violet-400/40 bg-[#141024]/95 text-gray-200"
      }`}
      style={{ left: pos.x, top: pos.y, zIndex: 30 }}
      title={`对外参数「${wire.sourceLabel}」· ${
        wire.targetSlot ? `已连到 ${wire.targetNodeId}.${wire.targetSlot}` : "未连线"
      }`}
      onPointerDown={(event) => {
        /* 只接管空白处拖拽；控件点击（选中 / 拖线）不触发移动。 */
        if ((event.target as HTMLElement).closest("[data-param-handle]")) return;
        dragRef.current = { dx: event.clientX, dy: event.clientY };
        (event.target as HTMLElement).setPointerCapture?.(event.pointerId);
        onPick(wire.sourceId);
      }}
      onPointerMove={(event) => {
        const drag = dragRef.current;
        if (!drag) return;
        const zoom = readZoom();
        const next = {
          x: pos.x + (event.clientX - drag.dx) / zoom,
          y: pos.y + (event.clientY - drag.dy) / zoom,
        };
        dragRef.current = { dx: event.clientX, dy: event.clientY };
        setPos(next);
      }}
      onPointerUp={() => {
        if (!dragRef.current) return;
        dragRef.current = null;
        try {
          window.localStorage.setItem(storageKey, JSON.stringify(pos));
        } catch {
          /* 忽略配额错误 */
        }
      }}
    >
      <span
        className="h-1.5 w-1.5 shrink-0 rounded-full"
        style={{ background: color, boxShadow: `0 0 6px ${color}` }}
      />
      <span className="truncate font-medium">{wire.sourceLabel}</span>
      {/* 源句柄：从这里拖到节点端口即建立映射连线（React Flow 原生的
       *  onConnect 会带上本节点的 data-param-source 与目标节点的端口 id）。 */}
      <span
        data-param-handle
        className="ml-auto h-2.5 w-2.5 shrink-0 cursor-crosshair rounded-full border border-white/60"
        style={{ background: color }}
        title="拖动到节点端口，改连这个对外参数"
        onPointerDown={(event) => {
          event.stopPropagation();
          onPick(wire.sourceId);
          /* 用参数自身的 id 作为连线源：与 ReactFlow 的 Handle id 命名空间
           * 一致，onConnect 里据此认出源对外参数。 */
          startNativeWire(event, wire.sourceId, onConnect);
        }}
      />
    </div>
  );
}

function readZoom(): number {
  const pane = document.querySelector<HTMLElement>(".react-flow__viewport");
  if (!pane) return 1;
  const transform = window.getComputedStyle(pane).transform;
  const m = /matrix\(([^)]+)\)/.exec(transform);
  if (!m) return 1;
  const parts = m[1]!.split(",").map((v) => Number(v.trim()));
  const zoom = parts[0] ?? 1;
  return Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
}

/* 原生连线：React Flow 的 Handle 拖拽走的是它自己的 pointer 事件集，
 * 从 Portal 节点里凭空发起不一定会被接管。这里改为「按住 → 松手时在指针下
 * 命中一个端口」的简化手势：在 pointerup 上用 document.elementFromPoint 找
 * 目标端口行（`data-pin-input` / `data-input-key`），命中即建立映射。
 * 相比硬塞 React Flow 内部 API，这条路径稳定、可测，且不依赖 React Flow 版本。 */
function startNativeWire(
  event: React.PointerEvent<HTMLElement>,
  sourceId: string,
  onConnect: (id: string, targetNodeId: string, slot: string) => void
) {
  const move = (ev: PointerEvent) => {
    highlightDropTarget(ev.clientX, ev.clientY, true);
  };
  const up = (ev: PointerEvent) => {
    document.removeEventListener("pointermove", move);
    document.removeEventListener("pointerup", up);
    highlightDropTarget(ev.clientX, ev.clientY, false);
    const hit = findDropTarget(ev.clientX, ev.clientY);
    if (hit) onConnect(sourceId, hit.nodeId, hit.slot);
  };
  document.addEventListener("pointermove", move);
  document.addEventListener("pointerup", up);
  void event;
}

function findDropTarget(x: number, y: number): { nodeId: string; slot: string } | null {
  const stack = document.elementsFromPoint(x, y);
  for (const el of stack) {
    if (!(el instanceof HTMLElement)) continue;
    const row = el.closest<HTMLElement>("[data-pin-input], [data-input-key]");
    if (!row) continue;
    const slot = row.dataset.pinInput ?? row.dataset.inputKey;
    const nodeEl = row.closest<HTMLElement>(".react-flow__node[data-id]");
    const nodeId = nodeEl?.dataset.id;
    if (slot && nodeId) return { nodeId, slot };
  }
  return null;
}

function highlightDropTarget(x: number, y: number, on: boolean) {
  const hit = findDropTarget(x, y);
  const row = hit
    ? document.querySelector<HTMLElement>(`[data-input-key="${CSS.escape(hit.slot)}"]`)
    : null;
  if (!row) return;
  row.style.outline = on ? "2px solid rgba(167,139,250,0.9)" : "";
  row.style.outlineOffset = on ? "1px" : "";
}
