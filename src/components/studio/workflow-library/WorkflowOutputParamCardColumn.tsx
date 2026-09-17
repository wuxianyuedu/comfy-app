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
 * 端点由消费方注入（`endpoint`）：库里那层注入 React Flow 的 `<Handle>`
 * （ISSUE #529）—— 手势与命中半径都由画布承担，卡片列本身不碰 React Flow。
 */

import type { WorkflowIOEntry } from "~/components/studio/shared/workflow-io";
import type { ReactNode } from "react";

import { WorkflowParamCard } from "../workflow-editor/WorkflowParamCard";
import { outputPortLabel } from "./workflow-library-param-cards";

/** 卡片宽度：与左侧输入卡片同宽，两列夹着宿主卡片时仍放得下。 */
const CARD_WIDTH = 200;

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
  /** 端点槽位：消费方注入 `<Handle>`（库里那层）或只读圆点。 */
  endpoint?: (port: {
    name: string;
    type: string;
    handleId: string;
  }) => ReactNode;
}

export function WorkflowOutputParamCardColumn({
  outputs,
  resolved,
  canWire = false,
  selectedOutputId = null,
  onSelect,
  isManual,
  onReset,
  endpoint,
}: WorkflowOutputParamCardColumnProps) {
  if (outputs.length === 0) return null;

  return (
    <aside
      className="flex shrink-0 flex-col gap-2 self-start"
      style={{ width: CARD_WIDTH }}
      aria-label="对外输出参数"
      data-testid="workflow-output-param-column"
    >
      <p className="text-ink-faint px-0.5 text-[11px] font-medium">
        {canWire ? "对外输出参数 · 拖圆点改取值行" : "对外输出参数"}
      </p>
      {outputs.map((output) => {
        /* 卡片头 = 这个输出口的名字（作者改过名就用作者的名字）；卡片体 = 端口
         *  自身的名字 + 类型 —— 与左侧输入卡片同构（头说「这是谁」，体说「它由
         *  哪些端口组成」）。 */
        const title = outputCardLabel(output);
        /* 显示名与锚点是**两件事**：名字是端口自己的名字（空 / 空白 → 「输出」）；
         *  锚点（handle id）用**输出的 ioKey** —— 它全图唯一，也就是落库键
         *  （`onConnect` 拿到的只有 handle id，直接取用）。 */
        const portLabel = outputPortLabel(output);
        const handleId = output.ioKey;
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
             *  `resolved[ioKey]` 只用来决定这颗点的观感（改过 = 实心提亮）。 */
            side="left"
            outputPorts={[
              {
                name: portLabel,
                type,
                /* 未连过（作者没改过这个口的取值行）在画布上**没有线** —— 这里也
                 *  不再报「已连接」：端口名跟着淡一档，与「这颗点有没有线」同一份
                 *  事实（`manual`，见 `deriveLibraryOutputCards`）。 */
                connected: manual,
                ioKey: output.ioKey,
                /* 锚点 = 输出的 ioKey（与边两端同一份取值）。 */
                handleId,
                active: manual || resolved?.[output.ioKey] === undefined,
              },
            ]}
            endpoint={() =>
              endpoint?.({
                name: portLabel,
                type,
                handleId,
              })
            }
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
