"use client";

/* ── 画布上的「对外输出参数节点」──
 *
 * 与左侧的对外**输入**参数卡片对称：每个对外输出（images / video…）一张卡片，
 * 下面一行是它自己的端口名与类型，**圆点骑跨卡片左缘** —— 宿主卡片上的输出行
 * （哪一行都行）拖到这颗圆点、或从这颗圆点拖到那一行，即完成「这个输出从哪一行
 * 取值」的绑定。
 *
 * 产出这张卡片的是 `buildOutputCards`：位置同样派生自宿主节点（作者拖不动，
 * 要挪就挪宿主节点），端点就是 React Flow 的 <Handle>。拖动的**语义**与输入卡片
 * 相反（输入：卡片 → 宿主行「这个参数喂给哪一行」；输出：宿主行 → 卡片「这个产出
 * 从哪一行读」），但两处都是同一套「卡片 ↔ 宿主节点端口」的手势。
 *
 * 卡片本体仍复用 `WorkflowParamCard`（`side="left"`）：输入卡片与输出卡片的行高 /
 * 圆点尺寸 / 骑跨偏移全部共用同一份常量，不会一边贴边一边内缩。
 */

import React from "react";
import { Handle, Position } from "@xyflow/react";

import {
  PARAM_NODE_DOT_OFFSET,
  PARAM_NODE_DOT_SIZE,
} from "~/lib/workflow-param-mapping";
import { paramClassStyle } from "../workflow-library/workflow-param-mapping-ui";
import { WorkflowParamCard } from "./WorkflowParamCard";
import { useHoverElevation } from "./HoverElevation";
import type { WorkflowOutputNodeData } from "./workflow-param-node-data";

export const WorkflowOutputParamNode = React.memo(
  function WorkflowOutputParamNode({
    data,
  }: {
    data: WorkflowOutputNodeData;
  }) {
    const style = paramClassStyle("output");
    /* 页脚一句话说清「这个产出现在从哪来、要怎么改」——与输入卡片同一套口径：
     * 没有落点时卡片上只剩一颗圆点，三种状态（默认行 / 改过 / 悬空）读起来一样。 */
    const footNote = !data.wired
      ? "已断开 · 拖圆点选一行取值"
      : data.wireManual
        ? "已连（你改过的取值行）· 可拖圆点改"
        : "默认取值行 · 可拖圆点改";
    const { hoverHandlers: hoverEvents, hoverRef } = useHoverElevation();

    return (
      <WorkflowParamCard
        entryId={data.outputIoKey}
        cls="output"
        label={data.label}
        classLabel="输出"
        hostNodeId={data.hostNodeId}
        width={data.width}
        canWire={data.canWire}
        footNote={footNote}
        wired={data.wired}
        canReset={data.canReset}
        onReset={data.onReset}
        hoverRef={hoverRef}
        hoverEvents={hoverEvents}
        /* 单个输出口一行：端点槽位在左侧（圆点骑跨卡片左缘）——线从宿主输出行
         *  进来，这一行就是它的锚。 */
        side="left"
        outputPorts={[
          {
            name: data.portName,
            type: data.portType,
            connected: true,
            ioKey: data.outputIoKey,
            handleId: data.portName,
            active: true,
          },
        ]}
        endpoint={() =>
          data.canWire ? (
            <Handle
              id={data.outputIoKey}
              type="target"
              position={Position.Left}
              isConnectable
              /* 与输入卡片的端点同一条约定：`connectable` 来自宿主节点，把两端
               *  的可连性显式授权到卡片自己身上，否则宿主节点上的
               *  `connectable: false` 会让这颗圆点变成点不动的装饰。 */
              isConnectableStart
              isConnectableEnd
              data-testid={`output-node-port-${data.outputIoKey}`}
              style={{
                position: "absolute",
                top: "50%",
                left: PARAM_NODE_DOT_OFFSET,
                width: PARAM_NODE_DOT_SIZE,
                height: PARAM_NODE_DOT_SIZE,
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
  },
);
