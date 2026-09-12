"use client";

/* 工作流库「画布节点」预览左侧的**只读对外参数卡片列**。
 *
 * 每个对外参数一张卡片（视觉本体复用 workflow-editor/WorkflowParamCard）：
 *   · 卡片头是参数名（作者在编辑器里勾选/改名后的那个名字）；
 *   · 卡片体逐行列出它包含的端口名与类型，端口行尾标出该端口落到宿主卡片的
 *     哪一行参数（只有一个端口时标「→ <参数名>」）；
 *   · 卡片右侧有一颗**带类型的小圆点端点**（输出端口），可与宿主卡片上被落到
 *     的那一行参数相连 —— 那是与项目画布同款的端点视觉（ISSUE #355 复审：
 *     「对外参数需要右侧有小圆点的端口，可和工作流节点上的参数相连」）。
 *   · 卡片不可拖、不可改落点 —— 拉线 / 断开 / 恢复默认都在编辑器画布上做；
 *     这里画的连线由 `WorkflowParamWires` 量出锚点后叠一层 SVG（只读呈现）。
 *
 * 与宿主卡片的**表单行**是同一条事实的两端，不重复表达：
 *   卡片 = 这个对外参数由哪些端口组成（归属）；
 *   表单行 = 这一格现在填的是什么值（值），行尾徽标标出它属于哪个对外参数。
 */

import {
  PARAM_NODE_DOT_OFFSET,
  PARAM_NODE_DOT_SIZE,
  paramOutputPorts,
  type ParamEntry,
  type ParamOutputPort,
} from "~/lib/workflow-param-mapping";
import type { WorkflowIOMap } from "~/components/studio/shared/workflow-io";
import { WorkflowParamCard } from "../workflow-editor/WorkflowParamCard";
import { paramClassStyle } from "./workflow-param-mapping-ui";
import { resolveTargetName } from "./workflow-library-param-cards";

/** 卡片宽度：与项目画布节点同宽，两列并排时仍放得下。 */
const CARD_WIDTH = 220;

/** 端点圆点的描边色 = 卡片底色，形成「半圆在外」的观感（与 PortHandle 的
 *  `dir="out"` 同一口径，见 shared/WorkflowPortHandle）。 */
const PORT_DOT_STROKE = "#16161C";

/** 端点圆点的颜色：**跟着输出端口的类型走**（与项目画布的 PortHandle 同一套
 *  配色规则，见 shared/WorkflowPortHandle 的 portColorFor）—— 看圆点颜色即可
 *  读出「这个口出去的是 STRING / INT / IMAGE」，不必先读文字徽标。
 *  未连线（`*`）时退回卡片分类色，避免一颗含义不明的中性灰点。 */
function outputPortColor(port: ParamOutputPort, fallback: string): string {
  if (!port.connected) return fallback;
  const t = port.type.toUpperCase();
  if (t === "IMAGE" || t === "MASK") return "#7C5CFC";
  if (t === "VIDEO" || t === "AUDIO" || t.startsWith("VHS_")) return "#FF5CA8";
  if (t === "STRING" || t === "INT" || t === "FLOAT" || t === "NUMBER")
    return "#9A9AAD";
  if (t === "BOOLEAN" || t === "BOOL") return "#67E89D";
  return "#5BC6FF";
}

export interface WorkflowParamCardColumnProps {
  entries: readonly ParamEntry[];
  /** 当前模式下「条目 → 目标 ioKey」的生效落点。 */
  resolved: Record<string, string | null>;
  io: WorkflowIOMap | null;
}

export function WorkflowParamCardColumn({
  entries,
  resolved,
  io,
}: WorkflowParamCardColumnProps) {
  if (entries.length === 0) return null;

  return (
    <aside
      className="flex shrink-0 flex-col gap-2 self-start"
      style={{ width: CARD_WIDTH }}
      aria-label="对外参数"
      data-testid="workflow-param-card-column"
    >
      <p className="px-0.5 text-[11px] font-medium text-(--color-ink-faint)">
        对外参数（只读）
      </p>
      {entries.map((entry) => {
        const target = resolveTargetName(io, resolved[entry.id]);
        const style = paramClassStyle(entry.cls);
        return (
          <WorkflowParamCard
            key={entry.id}
            entryId={entry.id}
            cls={entry.cls}
            label={entry.label}
            classLabel={style.label}
            hostNodeId={entry.nodeId}
            pins={entry.pins}
            width={CARD_WIDTH}
            /* 只读消费：卡片不参与连线，端点与「恢复默认」都不渲染。
             * `readOnly` 与 `canWire` 分开表达 —— 只读卡片不该写
             * 「先选模式才能连线」（节点上模式早就选好了，ISSUE #355 复审）。 */
            canWire={false}
            readOnly
            canReset={false}
            /* 带类型的输出端口：与编辑器同一份派生（类型跟着落点走），库里也
             * 读得到「提示词 → STRING」。 */
            outputPorts={paramOutputPorts(entry, io, resolved[entry.id])}
            /* 右侧小圆点端点：与项目画布节点上的端口同款视觉，圆点画在输出
             * 端口那一行的右沿（`data-wire-anchor` 供连线层量出锚点）。只读
             * 卡片不给它连线能力 —— 画面上的线由 WorkflowParamWires 叠一层。 */
            endpoint={(port, index) =>
              /* 一个对外参数只有一个出口 —— 只画第一行的圆点（与编辑器画布
               *  `endpoint={(_, index) => index === 0 && <Handle/>}` 同口径）。
               * 未连线时输出端口行会逐个列出候选，那几行是「能接到哪些类型」，
               * 不是多个出口，给每行都画点会凭空多出几个端点。 */
              index === 0 ? (
                <span
                  aria-hidden
                  data-wire-anchor={entry.id}
                  className="absolute top-1/2 shrink-0 rounded-full"
                  style={{
                    right: PARAM_NODE_DOT_OFFSET,
                    width: PARAM_NODE_DOT_SIZE,
                    height: PARAM_NODE_DOT_SIZE,
                    transform: "translateY(-50%)",
                    background: outputPortColor(port, style.color),
                    border: `1px solid ${PORT_DOT_STROKE}`,
                    boxShadow: "0 4px 4px rgba(0,0,0,0.25)",
                  }}
                />
              ) : null
            }
            /* 单端口条目在行尾标出它落到宿主卡片的哪一行；多端口条目
             * 还是显示端口类型（落点跟着具体端口名走）。 */
            rowTrailing={(pin) =>
              target && entry.pins.length === 1 ? (
                <span
                  className="shrink-0 truncate text-[9.5px] text-(--color-ink-fainter)"
                  title={`落点：${target}`}
                >
                  → {target}
                </span>
              ) : (
                <span className="shrink-0 font-mono text-[9.5px] text-(--color-ink-fainter)">
                  {pin.type}
                </span>
              )
            }
          />
        );
      })}
    </aside>
  );
}
