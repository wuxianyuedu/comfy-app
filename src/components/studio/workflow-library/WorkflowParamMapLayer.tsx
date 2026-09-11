"use client";

/* 工作流库「画布节点」预览上的**对外参数映射层**（只读）。
 *
 * 背景（ISSUE #355）：库详情过去只画一张宿主卡片，对外参数在画布上完全看不
 * 到。这里把编辑器的映射模型（对外参数 = 卡片、目标 = 宿主卡片上的端口行）
 * 以**只读**方式叠在预览卡片左侧：
 *   · 每个对外参数一张卡片（复用 WorkflowParamCard，与编辑器同款视觉）；
 *   · 一条贝塞尔连线从卡片右侧连到宿主卡片上被映射到的那一行端口；
 *   · 自动探测出来的默认线是虚线、作者改过的线是实线（与编辑器同口径）。
 *
 * 目标行坐标靠 DOM 测量（表单行带 `data-io-key` 标记）——端口行本身没有 React
 * Flow Handle，只能量。测量一律在 effect 里做并把结果落 state（渲染期读 ref
 * 会被 react-hooks/refs 拦下，且那样不会随尺寸变化重算）。resize 与 IO 变化都
 * 触发重测，所以卡片高度变了连线会跟着重算。
 *
 * 只读：卡片不可拖、不可改线；拉线 / 断开 / 恢复默认仍在编辑器画布上做。
 */

import { useEffect, useMemo, useState } from "react";

import {
  PARAM_NODE_GAP,
  PARAM_NODE_WIDTH,
  paramNodeHeight,
  type ParamEntry,
} from "~/lib/workflow-param-mapping";
import { WorkflowParamCard } from "../workflow-editor/WorkflowParamCard";
import { paramClassStyle } from "./workflow-param-mapping-ui";

/** 卡片列与宿主卡片左缘之间的水平距离（留出走线空间）。 */
const LAYER_GAP = 96;

/** 连线描边色（与编辑器 workflow-param-edges 同口径）。 */
const AUTO_STROKE = "#64748b";
const MANUAL_STROKE = "#a78bfa";

/** 在宿主卡片里找一个「组合参数」控件行（其 data-dimension-pins 含目标 ioKey）。 */
function queryDimensionRow(host: HTMLElement, ioKey: string): HTMLElement | null {
  for (const el of host.querySelectorAll<HTMLElement>("[data-dimension-pins]")) {
    const pins = (el.getAttribute("data-dimension-pins") ?? "").split(",").filter(Boolean);
    if (pins.includes(ioKey)) return el;
  }
  return null;
}

export interface WorkflowParamMapLayerProps {
  entries: readonly ParamEntry[];
  /** 当前模式下「条目 id → 目标 ioKey」。 */
  resolved: Record<string, string | null>;
  /** 某个条目在当前模式下是否作者画过线（决定线型）。 */
  isManual: (entryId: string) => boolean;
  /** 宿主卡片容器 —— 目标端口行在其内部，按 `data-io-key` 查。 */
  hostRef: React.RefObject<HTMLElement | null>;
}

interface WireGeometry {
  entryId: string;
  color: string;
  manual: boolean;
  /** 起点（卡片右缘中点，相对宿主容器左缘） */
  x1: number;
  y1: number;
  /** 终点（目标端口行左缘中点，相对宿主容器） */
  x2: number;
  y2: number;
}

/** 卡片堆叠几何：按顺序纵向排开，返回每张卡片的相对 Y（相对宿主容器顶）。 */
function cardOffsets(entries: readonly ParamEntry[]): Record<string, number> {
  const out: Record<string, number> = {};
  let y = 0;
  for (const entry of entries) {
    out[entry.id] = y;
    y += paramNodeHeight(entry) + PARAM_NODE_GAP;
  }
  return out;
}

export function WorkflowParamMapLayer({
  entries,
  resolved,
  isManual,
  hostRef,
}: WorkflowParamMapLayerProps) {
  const offsets = useMemo(() => cardOffsets(entries), [entries]);
  /* 测量结果 + 重测信号：尺寸/IO 变化时自增触发重算。 */
  const [wires, setWires] = useState<WireGeometry[]>([]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) {
      setWires([]);
      return;
    }

    const measure = () => {
      const hostRect = host.getBoundingClientRect();
      const next: WireGeometry[] = [];
      for (const entry of entries) {
        const targetSlot = resolved[entry.id];
        if (!targetSlot) continue;
        /* 目标行的找法：普通参数行带 `data-io-key`；宽/高、比例/像素这类
         * 组合参数由单个控件录入，没有独立行，退回到整块的 `data-dimension-pins`
         * （逗号分隔的 ioKey 列表）——连线于是连到该控件上。 */
        const row =
          host.querySelector<HTMLElement>(`[data-io-key="${CSS.escape(targetSlot)}"]`) ??
          queryDimensionRow(host, targetSlot);
        if (!row) continue;
        const rowRect = row.getBoundingClientRect();
        const offsetY = offsets[entry.id] ?? 0;
        const cardH = paramNodeHeight(entry);
        next.push({
          entryId: entry.id,
          color: paramClassStyle(entry.cls).color,
          manual: isManual(entry.id),
          /* 起点：卡片右缘中点。卡片列左缘在宿主容器左缘再往左
           * (LAYER_GAP + 卡宽)，右缘因此落在 -LAYER_GAP 处。 */
          x1: -LAYER_GAP,
          y1: offsetY + cardH / 2,
          /* 终点：目标行左缘中点。 */
          x2: rowRect.left - hostRect.left,
          y2: rowRect.top - hostRect.top + rowRect.height / 2,
        });
      }
      setWires(next);
    };

    /* 挂载后立刻量一次（子节点此刻已就绪）；下一帧再补一次，覆盖
     * 字体/控件尺寸在首帧之后才稳定的情况。 */
    measure();
    const raf = requestAnimationFrame(measure);
    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(measure);
      observer.observe(host);
    }
    return () => {
      cancelAnimationFrame(raf);
      observer?.disconnect();
    };
  }, [entries, resolved, isManual, offsets, hostRef]);

  if (entries.length === 0) return null;

  return (
    /* overlay 覆盖在卡片所在容器上；pointer-events-none 让卡片交互透传。 */
    <div
      className="pointer-events-none absolute inset-0"
      data-testid="workflow-param-map-layer"
    >
      {/* 卡片列：相对宿主容器左缘再往左 LAYER_GAP，纵向依次排开。 */}
      <div className="absolute top-0" style={{ left: -(LAYER_GAP + PARAM_NODE_WIDTH) }}>
        {entries.map((entry) => {
          const style = paramClassStyle(entry.cls);
          const canWire = Object.prototype.hasOwnProperty.call(resolved, entry.id);
          return (
            <div
              key={entry.id}
              className="pointer-events-auto absolute"
              style={{ left: 0, top: offsets[entry.id] ?? 0 }}
              data-testid={`library-param-card-${entry.id}`}
            >
              <WorkflowParamCard
                entryId={entry.id}
                cls={entry.cls}
                label={entry.label}
                classLabel={style.label}
                hostNodeId={entry.nodeId}
                pins={entry.pins}
                width={PARAM_NODE_WIDTH}
                canWire={canWire}
                /* 库内只读：不提供「恢复默认」（那是编辑动作）。 */
                canReset={false}
                endpoint={
                  canWire ? (
                    /* 装饰端点（与编辑器 Handle 几何一致）；库内不可拖线。 */
                    <span
                      aria-hidden
                      style={{
                        position: "absolute",
                        right: -6,
                        top: "50%",
                        width: 12,
                        height: 12,
                        borderRadius: 9999,
                        background: style.color,
                        border: "1px solid #16161C",
                        boxShadow: "0 4px 4px rgba(0,0,0,0.25)",
                        transform: "translateY(-50%)",
                      }}
                    />
                  ) : null
                }
              />
            </div>
          );
        })}
      </div>

      {/* 连线层：SVG 覆盖整个宿主容器，曲线从卡片端点连到目标端口行。
       *  overflow: visible 让左侧卡片区域（负坐标）的线也画得出来。 */}
      <svg
        className="absolute inset-0 h-full w-full"
        style={{ overflow: "visible" }}
        aria-hidden
      >
        {wires.map((w) => {
          const stroke = w.manual ? MANUAL_STROKE : AUTO_STROKE;
          /* 控制点水平外推，画出与编辑器一致的横向贝塞尔。 */
          const dx = Math.max(40, Math.abs(w.x2 - w.x1) * 0.5);
          const d = `M ${w.x1} ${w.y1} C ${w.x1 + dx} ${w.y1}, ${w.x2 - dx} ${w.y2}, ${w.x2} ${w.y2}`;
          return (
            <path
              key={w.entryId}
              d={d}
              fill="none"
              stroke={stroke}
              strokeWidth={w.manual ? 2.5 : 2}
              strokeDasharray={w.manual ? undefined : "6 4"}
              opacity={w.manual ? 1 : 0.75}
              data-testid={`library-param-wire-${w.entryId}`}
            />
          );
        })}
      </svg>
    </div>
  );
}
