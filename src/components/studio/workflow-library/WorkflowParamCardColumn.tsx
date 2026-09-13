"use client";

/* 工作流库「画布节点」预览左侧的**对外参数卡片列**（可编辑映射）。
 *
 * 每个对外参数一张卡片（视觉本体复用 workflow-editor/WorkflowParamCard）：
 *   · 卡片头是参数名（作者在编辑器里勾选/改名后的那个名字）；
 *   · 卡片体逐行列出它包含的端口名与类型，端口行尾标出该端口落到宿主卡片的
 *     哪一行参数（只有一个端口时标「→ <参数名>」）；
 *   · 卡片右侧有一颗**带类型的小圆点端点**（输出端口），可与宿主卡片上被落到
 *     的那一行参数相连 —— 那是与项目画布同款的端点视觉（ISSUE #355 复审：
 *     「对外参数需要右侧有小圆点的端口，可和工作流节点上的参数相连」）。
 *   · 卡片**可连线**（ISSUE #355：「连线要能编辑，现在编辑不了」）：从圆点按下
 *     并拖到宿主卡片上的某一行即改落点，卡片头的 ↺ 撤销该口的手工线。手势实现
 *     在 `WorkflowParamWires`（指针事件 + 命中测试），卡片只负责把圆点画出来并
 *     标上锚点 —— 卡片列自身仍不碰 React Flow（见 workflow-canvas-io-isolation）。
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

/** 卡片宽度：与项目画布节点同宽，两列并排时仍放得下。 */
const CARD_WIDTH = 220;

/** 只读连线锚点的值：条目 id + 端口的 handle id（两者都可能含 `::`，量测侧
 *  一律按属性整串精确比较，不做选择器转义、也不切分）。
 *
 *  用 `?` 当分隔符：它不与 `::`（ioKey 分隔符）冲突，也不会像 NUL 那样在
 *  HTML 属性里被吞掉 —— 一条锚点对应「卡片上的哪一颗圆点」。 */
export function wireAnchorValue(entryId: string, handleId: string): string {
  return `${entryId}?${handleId}`;
}

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
  /** 是否允许连线：库里也允许（拖圆点改落点）—— 没有模式时不给（写入无归属）。 */
  canWire?: boolean;
  /** 作者手里正选中的条目（线被点选 / 卡片被点）。 */
  selectedEntryId?: string | null;
  onSelect?: (entryId: string | null) => void;
  /** 该对外参数在当前模式下是否被作者改过（决定「恢复默认」可用性）。 */
  isManual?: (entryId: string) => boolean;
  onReset?: (entryId: string) => void;
  /** 宿主卡片此刻真的画得出来的端口（ioKey 集合）—— 候选圆点按它收窄：
   *  画不出端点的端口不给拖，拖过去也落不上。缺省 = 不收窄。 */
  reachableKeys?: ReadonlySet<string>;
}

export function WorkflowParamCardColumn({
  entries,
  resolved,
  io,
  canWire = false,
  selectedEntryId = null,
  onSelect,
  isManual,
  onReset,
  reachableKeys,
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
        {canWire ? "对外参数 · 拖圆点改落点" : "对外参数"}
      </p>
      {entries.map((entry) => {
        const style = paramClassStyle(entry.cls);
        return (
          <WorkflowParamCard
            key={entry.id}
            /* 选中的卡片（含被点选的线那一端）提亮：一条线上有三处（卡片、
             * 圆点、宿主行），选中状态必须同时在两端看得出来。 */
            selected={selectedEntryId === entry.id}
            onSelect={onSelect ? () => onSelect(entry.id) : undefined}
            entryId={entry.id}
            cls={entry.cls}
            label={entry.label}
            classLabel={style.label}
            hostNodeId={entry.hostNodeId || entry.nodeId}
            width={CARD_WIDTH}
            /* `canWire` 与 `readOnly` 分开表达：库里现在**可连线**（拖圆点改落点），
             * 但卡片本身仍是消费方托管的视觉本体 —— 不写「先选模式才能连线」那类
             * 编辑提示（节点上模式早就选好了，ISSUE #355）。 */
            canWire={canWire}
            readOnly={!canWire}
            canReset={canWire && !!isManual?.(entry.id)}
            onReset={canWire ? () => onReset?.(entry.id) : undefined}
            /* 带类型的输出端口：与编辑器同一份派生（类型跟着落点走），库里也
             * 读得到「提示词 → STRING」。 */
            outputPorts={paramOutputPorts(
              entry,
              io,
              resolved[entry.id],
              reachableKeys,
            )}
            /* 右侧小圆点端点：与项目画布节点上的端口同款视觉，圆点画在输出
             * 端口那一行的右沿（`data-wire-anchor` 供连线层量出锚点）。只读
             * 卡片不给它连线能力 —— 画面上的线由 WorkflowParamWires 叠一层。 */
            endpoint={(port) => (
              /* **每个候选一颗圆点**（与编辑器画布同口径）：未连线时输出端口行
               * 逐个列出候选（尺寸 = 宽/高/宽高比/像素量），每一行都是能接到的那
               * 一个候选口 —— 只给第一行画点会让「尺寸」看着只有一个出口
               * （ISSUE #355 复审）。
               *
               * 可连线时这颗点就是**拖线的起手位**（按下 → 拖到宿主行 → 写入落点），
               * 指针样式与命中范围由 `WorkflowParamWires` 处理。
               *
               * 它刻意**不是**一个 `role="button"` 的控件：拖拽手势没有键盘等价
               * 操作，谎报成按钮只会让读屏用户撞到一个按不动的控件。落点的查看与
               * 修改在编辑器画布上都是完整可及的（那里是真正的端点控件），这里只
               * 呈现当前落点并让鼠标手势更快。 */
              <span
                aria-hidden
                /* 连线锚点按**候选端口**认：一个端口一颗点，连线量到的就是那一颗。
                 * 值 = 条目 id + 端口的 handle id。量测侧按属性整串精确比较，
                 * 含 `::` 的端口键不做选择器转义（见 WorkflowParamWires）。 */
                data-wire-anchor={wireAnchorValue(entry.id, port.handleId)}
                title={
                  canWire
                    ? `拖到工作流参数行上改「${entry.label}」的落点`
                    : undefined
                }
                className={`absolute top-1/2 shrink-0 rounded-full ${
                  canWire ? "cursor-crosshair" : ""
                }`}
                style={{
                  right: PARAM_NODE_DOT_OFFSET,
                  width: PARAM_NODE_DOT_SIZE,
                  height: PARAM_NODE_DOT_SIZE,
                  transform: "translateY(-50%)",
                  background: outputPortColor(port, style.color),
                  border: `1px solid ${PORT_DOT_STROKE}`,
                  boxShadow: "0 4px 4px rgba(0,0,0,0.25)",
                  /* 生效落点那一颗实心，其余候选淡一档：与编辑器画布同口径。 */
                  opacity: port.active ? 1 : 0.55,
                }}
              />
            )}
          />
        );
      })}
    </aside>
  );
}
