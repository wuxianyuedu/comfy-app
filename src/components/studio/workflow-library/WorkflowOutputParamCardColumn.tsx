"use client";

/* 工作流库「画布节点」预览右侧的**对外输出参数卡片列**。
 *
 * 左侧那列说「这个工作流对外**要**什么」（提示词 / 尺寸 / 首帧 → 落到节点的哪一行），
 * 右侧这列说「它对外**给**什么」（images / video…）—— 两端对称，读者不必点开别的
 * 页签才知道这个工作流产出的是什么。
 *
 * 卡片视觉与左侧输入卡片共用同一份本体（`WorkflowParamCard` 的 `side="left"`）：
 * 圆点骑跨卡片**左**缘，线从宿主卡片上**取值那一行**的圆点出发收在它上面。差别
 * 只在端点所在的一侧，几何常量与行高完全一致，不会一边贴边一边内缩。
 *
 * **可拖**（ISSUE #355）：输出的连线也在库里改 —— 拖卡片左缘那颗圆点到宿主卡片的
 * 另一行输出端口上，即把「这个输出口从哪一行取值」改到那一行；卡片头的 ↺ 恢复它
 * 自带的那一行。落点覆盖写 `paramMap.output.mode:<模式>`（见
 * `~/lib/workflow-output-binding`），与输入侧的 `paramMap.source.mode:<模式>`
 * 同构、**不同键空间**。
 *
 * 手感与输入侧逐条对齐（同一个手势不该在两个列上一个受理、一个拒绝）：
 *   · 拖动中预览线跟随光标；落在宿主输出行上松开才写入，落在空白处什么都不做；
 *   · 已经取值于自身那一行、又没被改过时，↺ 不可用（点了不会有变化）。
 *
 * 手势本身不在本层：卡片只画圆点并标 `data-wire-anchor` 锚点，按下 / 移动 / 松开
 * 由 `WorkflowParamWires` 承担（库里没有 React Flow 上下文）。
 */

import {
  PARAM_NODE_DOT_OFFSET,
  PARAM_NODE_DOT_SIZE,
} from "~/lib/workflow-param-mapping";
import type { WorkflowIOEntry } from "~/components/studio/shared/workflow-io";
import { WorkflowParamCard } from "../workflow-editor/WorkflowParamCard";
import { paramClassStyle } from "./workflow-param-mapping-ui";
import { wireAnchorValue } from "./WorkflowParamCardColumn";

/** 卡片宽度：与左侧输入卡片同宽，两列夹着宿主卡片时仍放得下。 */
const CARD_WIDTH = 200;

/** 端点圆点的描边色（卡片底色）—— 与输入卡片同口径。 */
const PORT_DOT_STROKE = "#16161C";

export interface WorkflowOutputParamCardColumnProps {
  /** 工作流对外暴露的输出（`workflowIO` 里 `direction: "output"` 的那些）。 */
  outputs: readonly (WorkflowIOEntry & { ioKey: string })[];
  /** 输出口 ioKey → 当前取值的那一行 ioKey（`null` = 悬空 / 作者断开）。
   *  由 `deriveLibraryOutputCards` 派生；缺省时每个口取值于它自己那一行。 */
  resolved?: Record<string, string | null>;
  /** 是否允许拖改（有模式、且上层给了落库回调时才为真）。 */
  canWire?: boolean;
  /** 作者手里正选中的输出口。 */
  selectedOutputId?: string | null;
  onSelect?: (ioKey: string | null) => void;
  /** 该输出口在当前模式下是否被作者改过（决定「恢复默认」可用性）。 */
  isManual?: (ioKey: string) => boolean;
  onReset?: (ioKey: string) => void;
}

export function WorkflowOutputParamCardColumn({
  outputs,
  resolved,
  canWire = false,
  selectedOutputId = null,
  onSelect,
  isManual,
  onReset,
}: WorkflowOutputParamCardColumnProps) {
  if (outputs.length === 0) return null;
  const style = paramClassStyle("output");

  return (
    <aside
      className="flex shrink-0 flex-col gap-2 self-start"
      style={{ width: CARD_WIDTH }}
      aria-label="对外输出参数"
      data-testid="workflow-output-param-column"
    >
      <p className="px-0.5 text-[11px] font-medium text-(--color-ink-faint)">
        {canWire ? "对外输出参数 · 拖圆点改取值行" : "对外输出参数"}
      </p>
      {outputs.map((output) => {
        /* 卡片头 = 这个输出口的名字（作者改过名就用作者的名字）；卡片体 = 端口
         *  自身的名字 + 类型 —— 与左侧输入卡片同构（头说「这是谁」，体说「它由
         *  哪些端口组成」）。 */
        const title = outputCardLabel(output);
        const portName = (output.name ?? "").trim() || title;
        const type = output.type ?? "*";
        const manual = !!isManual?.(output.ioKey);
        return (
          <WorkflowParamCard
            key={output.ioKey}
            entryId={output.ioKey}
            cls="output"
            label={title}
            classLabel="输出"
            hostNodeId={output.nodeId}
            width={CARD_WIDTH}
            /* 每个输出口都是一次落点编辑的起点：拖动左缘那颗圆点即改「从哪一行
             *  取值」。它不与输入侧共用键空间，所以这里是 `canWire`（可拖）而不是
             *  输入卡片那种「不可编辑」的只读态。 */
            canWire={canWire}
            readOnly={!canWire}
            canReset={canWire && manual}
            onReset={canWire ? () => onReset?.(output.ioKey) : undefined}
            selected={selectedOutputId === output.ioKey}
            onSelect={onSelect ? () => onSelect(output.ioKey) : undefined}
            /* 端点槽位在**左侧**：圆点骑跨卡片左缘，线从宿主输出行进来。
             *  `data-wire-anchor` 供连线层量出锚点（与输入卡片同一套属性契约），
             *  `resolved[ioKey]` 只用来决定这颗点的观感（改过 = 实心提亮）。 */
            side="left"
            outputPorts={[
              {
                name: portName,
                type,
                connected: true,
                ioKey: output.ioKey,
                /* 库里那层连线按**端口名**找卡片上的圆点锚点（与输入卡片刻度
                 *  一致，见 `wireAnchorValue` 的用法）。 */
                handleId: portName,
                active: manual || resolved?.[output.ioKey] === undefined,
              },
            ]}
            endpoint={() => (
              <span
                aria-hidden
                data-wire-anchor={wireAnchorValue(output.ioKey, portName)}
                /* 声明这是「输出取值行」的起手位：连线层据此只认输**出**行的
                 *  落点，并把结果上抛给 `onConnectOutput`。 */
                data-wire-kind="hostToParam"
                title={
                  canWire
                    ? `拖到工作流输出行上改「${title}」从哪一行取值`
                    : undefined
                }
                className={`absolute top-1/2 shrink-0 rounded-full ${
                  canWire ? "cursor-crosshair" : ""
                }`}
                style={{
                  left: PARAM_NODE_DOT_OFFSET,
                  width: PARAM_NODE_DOT_SIZE,
                  height: PARAM_NODE_DOT_SIZE,
                  transform: "translateY(-50%)",
                  background: style.color,
                  border: `1px solid ${PORT_DOT_STROKE}`,
                  boxShadow: "0 4px 4px rgba(0,0,0,0.25)",
                }}
              />
            )}
          />
        );
      })}
    </aside>
  );
}

/** 卡片标题：作者改了名就用作者的名字，否则退回类别名「输出」。
 *
 *  作者没改名时 `label === name`，标题照抄端口名会让卡片把同一句话写两遍
 *  （标题「images」+ 端口行「images IMAGE」）—— 端口名由卡片体的端口行负责，
 *  标题只说「这是一个对外输出的口」，与左列的「提示词 / 尺寸」是同一层语义。 */
function outputCardLabel(output: WorkflowIOEntry & { ioKey: string }): string {
  const label = (output.label ?? "").trim();
  const name = (output.name ?? "").trim();
  return label && label !== name ? label : "输出";
}
