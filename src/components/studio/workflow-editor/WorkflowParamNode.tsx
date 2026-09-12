"use client";

/* ── 画布上的「对外参数节点」──
 *
 * 每个对外参数（提示词 / 尺寸 / 首帧…）在编辑器画布上是**一个真实节点**：标题是
 * 参数的对外名，下面逐行列出它包含的端口，右侧**每个候选落点一颗输出端点**。
 * 作者把某一颗端点拖到宿主节点的对应端口上即完成连线 —— 映射就是画布上的连线，
 * 不再有另一套界面。
 *
 * 「尺寸」这类多候选口子因此是有**多颗**端点的：宽 / 高 / 宽高比 / 像素量各一颗，
 * 拖哪颗就连到哪个候选（ISSUE #355 复审：此前只画一颗，另外几个候选没有端口）。
 *
 * 两条交互约束：
 *   · 没有选中模式时不渲染输出端点，连线无从拖起，卡片上给出说明；
 *   · 「恢复默认」只在当前模式下确实画过线时可用（否则点了没有变化）。
 */

import React from "react";
import { Handle, Position } from "@xyflow/react";

import {
  PARAM_NODE_DOT_OFFSET,
  PARAM_NODE_DOT_SIZE,
} from "~/lib/workflow-param-mapping";
import { useHoverElevation } from "./HoverElevation";
import { paramClassStyle } from "../workflow-library/workflow-param-mapping-ui";
import { WorkflowParamCard } from "./WorkflowParamCard";
import type { WorkflowParamNodeData } from "./workflow-param-node-data";

export const WorkflowParamNode = React.memo(function WorkflowParamNode({
  data,
}: {
  data: WorkflowParamNodeData;
}) {
  const style = paramClassStyle(data.cls);
  /* 悬浮置顶：对外参数卡片同样要压住连线（ISSUE #400）。
   *  它自带的 zIndex 已是 20（比普通节点高，见 buildParamNodes），但连线仍
   *  可能盖上来；这里与 FlowNode / 子图卡片共用同一档悬浮层。 */
  const { hoverHandlers: hoverEvents, hoverRef } = useHoverElevation();

  return (
    <WorkflowParamCard
      entryId={data.entryId}
      cls={data.cls}
      label={data.label}
      classLabel={data.classLabel}
      hostNodeId={data.hostNodeId}
      inputRows={data.inputRows}
      width={data.width}
      canWire={data.canWire}
      noModeHint={data.noModeHint}
      canReset={data.canReset}
      onReset={data.onReset}
      /* 端口行只列名字：卡片本身不标落点，落点由那条线表达（落点名写在下面
       * 输出端口那一行、贴着端点，不重复标一次）。行高必须与 PARAM_NODE_ROW_H
       * 同口径，否则卡片实际高度与 placeParamNodes 算出的位置对不上，卡片会
       * 互相压住。 */
      hoverRef={hoverRef}
      hoverEvents={hoverEvents}
      /* 输出端口：每个候选一颗端点，端点就挂在该候选那一行上 —— 卡片右侧出去的
       * 是一个**具体的落点**，不是一颗无属性的圆点。 */
      outputPorts={data.outputPorts}
      /* 端点 id = 该候选端口的 ioKey：与宿主节点那一行的 handle id 同名，
       *  拖线两端才对得上（同名 pin 出现在别的节点上时也不会接错行）。 */
      endpoint={(port, index) =>
        data.canWire && port.ioKey ? (
          <Handle
            id={port.ioKey}
            type="source"
            position={Position.Right}
            isConnectable
            data-testid={`param-node-port-${data.entryId}-${index}`}
            style={{
              position: "absolute",
              /* 圆心骑跨卡片右缘（行是端点定位的锚，偏移里含行内边距）——
               * 与工作流库那张只读卡片用同一个常量，两处圆点不会一边贴边、
               * 一边内缩。 */
              top: "50%",
              right: PARAM_NODE_DOT_OFFSET,
              width: PARAM_NODE_DOT_SIZE,
              height: PARAM_NODE_DOT_SIZE,
              borderRadius: 9999,
              background: style.color,
              border: "1px solid #16161C",
              boxShadow: "0 4px 4px rgba(0,0,0,0.25)",
              /* 已经落上的那一颗实心、稍大一点点：一眼看出「这个口现在连出去的是
               * 哪一颗」，其余候选是同样大小的空心感（同色描边）。 */
              opacity: port.active ? 1 : 0.55,
            }}
          />
        ) : null
      }
    />
  );
});
