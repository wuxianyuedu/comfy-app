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
 *
 * 卡片的视觉本体在 WorkflowParamCard（与工作流库只读展示共用），本文件只负责
 * 把编辑器特有的 <Handle> 端点挂上去。
 */

import React from "react";
import { Handle, Position } from "@xyflow/react";

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
      canReset={data.canReset}
      onReset={data.onReset}
      /* 输出端点：连线从这里拖到宿主节点的端口。没有模式时整个 Handle 不渲染
       * —— React Flow 找不到 handle 就拖不出线，等于「禁止连线」，比只在前端
       * 拦一道更彻底。 */
      endpoint={
        data.canWire ? (
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
        ) : null
      }
    />
  );
});
