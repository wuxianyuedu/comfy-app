"use client";

/* 对外参数卡片的**视觉本体**（无 React Flow 依赖）。
 *
 * 卡片有两个消费场景：
 *   · 编辑器画布 —— 由 WorkflowParamNode 包一层 <Handle>，端点可拖线（编辑）；
 *   · 工作流库画布 —— 只读展示，端点是一条装饰圆点 + 自绘连线的起点。
 * 两处的头部 / 端口行 / 「恢复默认」必须完全一致，故把视觉收敛到这里，
 * 消费方只负责在右侧挂「端点」这一件事（editor→Handle，library→圆点）。
 */

import { RotateCcw } from "lucide-react";

import type { ParamEntry } from "~/lib/workflow-param-mapping";
import {
  PARAM_NODE_HEADER_H,
  PARAM_NODE_ROW_H,
} from "~/lib/workflow-param-mapping";
import { paramClassStyle } from "../workflow-library/workflow-param-mapping-ui";

export interface WorkflowParamCardProps {
  entryId: string;
  cls: ParamEntry["cls"];
  label: string;
  /** 分类中文名（悬停提示用）。 */
  classLabel: string;
  hostNodeId: string;
  pins: ParamEntry["pins"];
  width: number;
  /** 是否允许连线：false 时卡片置灰、给出「先选模式才能连线」提示。 */
  canWire: boolean;
  /** 「恢复默认」是否可用。库内只读时传 false 且不渲染按钮回调。 */
  canReset: boolean;
  onReset?: () => void;
  /** 右侧端点槽位（编辑器 = <Handle>，库内 = 装饰圆点）。 */
  endpoint?: React.ReactNode;
}

export function WorkflowParamCard({
  entryId,
  cls,
  label,
  classLabel,
  hostNodeId,
  pins,
  width,
  canWire,
  canReset,
  onReset,
  endpoint,
}: WorkflowParamCardProps) {
  const style = paramClassStyle(cls);
  const disabled = !canWire;

  return (
    <div
      className="relative flex flex-col rounded-lg border shadow-[0_4px_20px_rgba(0,0,0,0.45)]"
      style={{
        width,
        borderColor: disabled ? "rgba(148,163,184,0.28)" : `${style.color}66`,
        background: "var(--color-card, #16161C)",
        isolation: "isolate",
      }}
      data-testid={`param-node-${entryId}`}
    >
      {/* 头部：分类圆点 + 对外参数名 + 「恢复默认」 */}
      <div
        className="flex shrink-0 items-center gap-1.5 px-2"
        style={{
          height: PARAM_NODE_HEADER_H,
          borderBottom: "1px solid rgba(255,255,255,0.06)",
          background: `${style.color}14`,
        }}
      >
        <span
          className="h-1.5 w-1.5 shrink-0 rounded-full"
          style={{
            background: style.color,
            boxShadow: `0 0 6px ${style.color}`,
          }}
        />
        <span
          className="min-w-0 flex-1 truncate text-[11px] font-semibold text-(--color-ink-bright)"
          title={`${classLabel} · ${hostNodeId}`}
        >
          {label}
        </span>
        {onReset && (
          <button
            type="button"
            onClick={onReset}
            disabled={!canReset}
            className={`nodrag nopan shrink-0 rounded p-0.5 transition-colors ${
              canReset
                ? "text-(--color-ink-soft) hover:bg-white/8 hover:text-(--color-ink-bright)"
                : "cursor-default text-(--color-ink-fainter)"
            }`}
            data-testid={`param-node-reset-${entryId}`}
            title={
              canReset
                ? "恢复默认：撤销该对外参数在当前模式下的连线，回到自动探测的默认线"
                : "已是默认连线状态"
            }
            aria-label="恢复默认"
          >
            <RotateCcw size={11} />
          </button>
        )}
      </div>

      {/* 端口行：一行一个 pin，仅作展示（真正的连线手柄在卡片右侧）。 */}
      <div className="flex flex-col px-2 py-1">
        {pins.map((pin) => (
          <div
            key={pin.ioKey}
            className="flex min-w-0 items-center gap-1.5 text-[10.5px] text-(--color-ink-soft)"
            style={{ height: PARAM_NODE_ROW_H }}
            title={`${pin.name} · ${pin.type}`}
          >
            <span className="min-w-0 flex-1 truncate">{pin.name}</span>
            <span className="shrink-0 font-mono text-[9.5px] text-(--color-ink-fainter)">
              {pin.type}
            </span>
          </div>
        ))}
      </div>

      {disabled && (
        <div className="px-2 pb-1.5 text-[9.5px] leading-relaxed text-amber-500/80">
          先选模式才能连线
        </div>
      )}

      {endpoint}
    </div>
  );
}
