"use client";

/* 工作流库「画布节点」预览右侧的**对外输出参数卡片列**（只读）。
 *
 * 左侧那列说「这个工作流对外**要**什么」（提示词 / 尺寸 / 首帧 → 落到节点的哪一行），
 * 右侧这列说「它对外**给**什么」（images / video…）—— 两端对称，读者不必点开别的
 * 页签才知道这个工作流产出的是什么。
 *
 * 卡片视觉与左侧输入卡片共用同一份本体（`WorkflowParamCard` 的 `side="left"`）：
 * 圆点骑跨卡片**左**缘，线从宿主卡片的输出行圆点出发收在它上面。差别只在端点
 * 所在的一侧，几何常量与行高完全一致，不会一边贴边一边内缩。
 *
 * **只读**：输出参数不参与映射（没有「落点」可言，也没有 `paramMap` 键空间），
 * 所以这里不给连线的拖拽手势，也不给「恢复默认」—— 拉不动的东西就不要摆出可拉的
 * 样子。线的呈现由 `WorkflowParamWires` 承担（同一层、同一套量测）。
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
}

export function WorkflowOutputParamCardColumn({
  outputs,
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
        对外输出参数
      </p>
      {outputs.map((output) => {
        /* 卡片头 = 这个输出口的名字（作者改过名就用作者的名字）；卡片体 = 端口
         *  自身的名字 + 类型 —— 与左侧输入卡片同构（头说「这是谁」，体说「它由
         *  哪些端口组成」）。 */
        const title = outputCardLabel(output);
        const portName = (output.name ?? "").trim() || title;
        const type = output.type ?? "*";
        return (
          <WorkflowParamCard
            key={output.ioKey}
            entryId={output.ioKey}
            cls="output"
            label={title}
            classLabel="输出"
            hostNodeId={output.nodeId}
            width={CARD_WIDTH}
            /* 只读消费：没有连线能力，也没有编辑提示（输出参数不参与映射）。 */
            canWire={false}
            readOnly
            canReset={false}
            /* 端点槽位在**左侧**：圆点骑跨卡片左缘，线从宿主输出行进来。
             *  `data-wire-anchor` 供连线层量出锚点（与输入卡片同一套属性契约）。 */
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
                active: true,
              },
            ]}
            endpoint={() => (
              <span
                aria-hidden
                data-wire-anchor={wireAnchorValue(output.ioKey, portName)}
                className="absolute top-1/2 shrink-0 rounded-full"
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
