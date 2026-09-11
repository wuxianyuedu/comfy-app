"use client";

/* ── 画布上的「对外参数节点」──
 *
 * 每个对外参数（= 一个节点上被暴露的一类输入，可能含多个端口，例如宽度 +
 * 高度）在编辑器画布上是**一个真实节点**：标题是参数的对外名，下面逐行列出
 * 它包含的端口，右侧一个输出端点。作者把这个端点拖到宿主节点的端口上即可
 * 完成连线 —— 映射就是画布上的连线，不再有另一套界面。
 *
 * 三条交互约束（对应「没有模式禁止连线」）：
 *   · 没有选中模式时**不渲染输出端点**，连线无从拖起，卡片上给出说明；
 *   · 「恢复默认」只在当前模式下确实画过线时可用（否则点了没有变化）；
 *   · 卡片本身不可拖动 —— 位置跟着宿主节点派生（见 placeParamNodes），
 *     避免出现「换个环境打开发现卡片飘到天边」。
 */

import React from "react";
import { Handle, Position } from "@xyflow/react";
import { RotateCcw } from "lucide-react";

import { PARAM_NODE_HEADER_H, PARAM_NODE_ROW_H } from "~/lib/workflow-param-mapping";
import { paramClassStyle } from "../workflow-library/workflow-param-mapping-ui";
import type { WorkflowParamNodeData } from "./workflow-param-node-data";

export const WorkflowParamNode = React.memo(function WorkflowParamNode({
  data,
}: {
  data: WorkflowParamNodeData;
}) {
  const style = paramClassStyle(data.cls);
  const disabled = !data.canWire;

  return (
    <div
      className="relative flex flex-col rounded-lg border shadow-[0_4px_20px_rgba(0,0,0,0.45)]"
      style={{
        width: data.width,
        borderColor: disabled ? "rgba(148,163,184,0.28)" : `${style.color}66`,
        background: "var(--color-card, #16161C)",
        isolation: "isolate",
      }}
      data-testid={`param-node-${data.entryId}`}
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
          style={{ background: style.color, boxShadow: `0 0 6px ${style.color}` }}
        />
        <span
          className="min-w-0 flex-1 truncate text-[11px] font-semibold text-(--color-ink-bright)"
          title={`${data.classLabel} · ${data.hostNodeId}`}
        >
          {data.label}
        </span>
        <button
          type="button"
          onClick={data.onReset}
          disabled={!data.canReset}
          className={`nodrag nopan shrink-0 rounded p-0.5 transition-colors ${
            data.canReset
              ? "text-(--color-ink-soft) hover:bg-white/8 hover:text-(--color-ink-bright)"
              : "cursor-default text-(--color-ink-fainter)"
          }`}
          data-testid={`param-node-reset-${data.entryId}`}
          title={
            data.canReset
              ? "恢复默认：撤销该对外参数在当前模式下的连线，回到自动探测的默认线"
              : "已是默认连线状态"
          }
          aria-label="恢复默认"
        >
          <RotateCcw size={11} />
        </button>
      </div>

      {/* 端口行：一行一个 pin，仅作展示（真正的连线手柄在卡片右侧，见下）。
          行数决定卡片高度，与 paramNodeHeight() 同口径。 */}
      <div className="flex flex-col px-2 py-1">
        {data.pins.map((pin) => (
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

      {/* 输出端点：连线从这里拖到宿主节点的端口。没有模式时整个 Handle 不渲染
          —— React Flow 找不到 handle 就拖不出线，等于「禁止连线」，比只在前端
          拦一道更彻底。 */}
      {data.canWire && (
        <Handle
          type="source"
          position={Position.Right}
          id="pio-out"
          isConnectable
          style={{
            right: -6,
            width: 12,
            height: 12,
            borderRadius: 9999,
            background: style.color,
            border: "1px solid #16161C",
            boxShadow: "0 4px 4px rgba(0,0,0,0.25)",
          }}
        />
      )}
    </div>
  );
});
