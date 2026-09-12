"use client";

/* ── 画布上的「对外参数节点」──
 *
 * 每个对外参数（= 一个节点上被暴露的一类输入，可能含多个端口，例如宽度 +
 * 高度）在编辑器画布上是**一个真实节点**：标题是参数的对外名，下面逐行列出
 * 它包含的端口，右侧一个输出端点。作者把这个端点拖到宿主节点的端口上即可
 * 完成连线 —— 映射就是画布上的连线，不再有另一套界面。
 *
 * 两条交互约束（对应「没有模式禁止连线」）：
 *   · 没有选中模式时**不渲染输出端点**，连线无从拖起，卡片上给出说明；
 *   · 「恢复默认」只在当前模式下确实画过线时可用（否则点了没有变化）。
 */

import React from "react";
import { Handle, Position } from "@xyflow/react";

import { PARAM_NODE_ROW_H } from "~/lib/workflow-param-mapping";
import { paramClassStyle } from "../workflow-library/workflow-param-mapping-ui";
import { WorkflowParamCard } from "./WorkflowParamCard";
import type { WorkflowParamNodeData } from "./workflow-param-node-data";

export const WorkflowParamNode = React.memo(function WorkflowParamNode({
  data,
}: {
  data: WorkflowParamNodeData;
}) {
  const style = paramClassStyle(data.cls);

  return (
    <WorkflowParamCard
      entryId={data.entryId}
      cls={data.cls}
      label={data.label}
      classLabel={data.classLabel}
      hostNodeId={data.hostNodeId}
      pins={data.pins}
      width={data.width}
      canWire={data.canWire}
      noModeHint={data.noModeHint}
      canReset={data.canReset}
      onReset={data.onReset}
      /* 端口行只列名字：卡片本身不标落点，落点由那条线表达。行高必须与
       *  PARAM_NODE_ROW_H 同口径，否则卡片实际高度与 placeParamNodes 算出的
       *  位置对不上，卡片会互相压住。 */
      rowTrailing={(pin) => (
        <span className="shrink-0 font-mono text-[9.5px] text-(--color-ink-fainter)">
          {pin.type}
        </span>
      )}
      /* 带类型的输出端口：类型跟着当前落点走（提示词 → STRING）。端点就挂在这
       * 一行上 —— 卡片右侧出去的是一个**有类型的端口**，不是一颗无属性的圆点。 */
      outputPorts={data.outputPorts}
      endpoint={(_, index) =>
        /* 输出端点：连线从这里拖到宿主节点的端口。没有模式时整个 Handle 不渲染
           —— React Flow 找不到 handle 就拖不出线，等于「禁止连线」。
           只在第一条端口行上挂一个（一个对外参数只有一个出口）。 */
        data.canWire && index === 0 ? (
          <Handle
            type="source"
            position={Position.Right}
            id="pio-out"
            isConnectable
            style={{
              position: "absolute",
              top: "50%",
              right: -10,
              width: 12,
              height: 12,
              borderRadius: 9999,
              background: style.color,
              border: "1px solid #16161C",
              boxShadow: "0 4px 4px rgba(0,0,0,0.25)",
            }}
          />
        ) : null
      }
    />
  );
});

/** 卡片头 + 端口行的高度 —— 与 PARAM_NODE_ROW_H 同口径，供测试引用。 */
export const PARAM_NODE_ROW_HEIGHT = PARAM_NODE_ROW_H;
