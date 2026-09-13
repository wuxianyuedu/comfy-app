/* 画布上的「对外输出参数卡片」与取值线（纯函数）—— ISSUE #355
 *
 * 用户口径：「右列的对外输出参数目前是只读（线自动连上、不能拖改）…需要可拖」
 * （例如临时把 `images` 指到别处）。画布这一侧因此多了一张 `pout:` 卡片与一条
 * 「宿主输出行 → 卡片」的线：拖线即改取值行，线写 `paramMap.output.mode:<模式>`。
 *
 * 这里钉住纯派生：卡片位置（宿主右侧一列、派生自宿主坐标）、卡片内容、连线方向
 * 与状态着色（默认虚线 / 改过实线 / 断开不画），以及连线闸门的方向判据。 */

import { describe, expect, it } from "vitest";

import { outputNodeId } from "~/lib/workflow-param-mapping";
import { applyOutputBindingEdit } from "~/lib/workflow-output-binding";
import type { WorkflowIOMap } from "~/components/studio/shared/workflow-io";
import { splitWorkflowIO } from "~/components/studio/shared/workflow-io";
import { isValidOutputConnection } from "./workflow-param-edges";
import {
  buildOutputWiring,
  outputBindingOverridden,
} from "./workflow-output-nodes";

const io: WorkflowIOMap = {
  "5::output::IMAGE": {
    direction: "output",
    kind: "output",
    nodeId: "5",
    name: "images",
    type: "IMAGE",
    displayOrder: 0,
  },
  "5::output::VIDEO": {
    direction: "output",
    kind: "output",
    nodeId: "5",
    name: "video",
    type: "VIDEO",
    displayOrder: 1,
  },
  "5::widget::text": {
    direction: "input",
    kind: "widget",
    nodeId: "5",
    name: "text",
    type: "STRING",
  },
};

const outputs = splitWorkflowIO(io).outputs;
const hostPosById = { "5": { x: 100, y: 200 } };

function build(paramMap: Record<string, unknown> = {}, mode: string | null = "T2I") {
  return buildOutputWiring({
    io,
    outputs,
    paramMap,
    mode,
    hostPosById,
    onReset: () => undefined,
  });
}

describe("输出卡片与取值线", () => {
  it("每个输出一张卡片，排在宿主节点右侧（位置派生自宿主坐标）", () => {
    const { nodes } = build();
    expect(nodes.map((node) => node.id)).toEqual([
      outputNodeId("5::output::IMAGE"),
      outputNodeId("5::output::VIDEO"),
    ]);
    for (const node of nodes) {
      expect(node.type).toBe("wfOutput");
      expect(node.draggable).toBe(false);
      expect(node.connectable).toBe(true);
      expect(node.position!.x).toBeGreaterThan(hostPosById["5"].x);
    }
    /* 同一宿主的两张卡片纵向排开，不互相压住。 */
    expect(nodes[1]!.position!.y).toBeGreaterThan(nodes[0]!.position!.y);
  });

  it("卡片头不把端口名再抄一遍，卡片体带端口名与类型", () => {
    const { nodes } = build();
    const data = nodes[0]!.data as Record<string, unknown>;
    expect(data.label).toBe("输出");
    expect(data.portName).toBe("images");
    expect(data.portType).toBe("IMAGE");
  });

  it("默认线：从宿主自己的输出行出发、虚线，落在卡片上", () => {
    const { edges, resolved } = build();
    expect(resolved["5::output::IMAGE"]).toBe("5::output::IMAGE");
    /* 第二个输出没连过也没有默认落点 —— 悬空，不硬凑一个来源。 */
    expect(resolved["5::output::VIDEO"]).toBeNull();
    expect(edges).toHaveLength(1);
    const edge = edges[0]!;
    /* 方向与输入侧相反：宿主输出行是起点，卡片是终点。 */
    expect(edge.source).toBe("5");
    expect(edge.sourceHandle).toBe("5::output::IMAGE");
    expect(edge.target).toBe(outputNodeId("5::output::IMAGE"));
    expect(edge.targetHandle).toBe("5::output::IMAGE");
    expect(edge.style!.strokeDasharray).toBe("6 4");
  });

  it("改过取值行：实线，且卡片头「恢复默认」可用", () => {
    const paramMap = applyOutputBindingEdit(null, {
      outputIoKey: "5::output::VIDEO",
      ioKey: "5::output::IMAGE",
      mode: "T2I",
    });
    const { edges, nodes } = build(paramMap);
    const edge = edges.find((item) => item.target === outputNodeId("5::output::VIDEO"))!;
    expect(edge.sourceHandle).toBe("5::output::IMAGE");
    expect(edge.style!.strokeDasharray).toBeUndefined();
    const data = nodes.find(
      (node) => node.id === outputNodeId("5::output::VIDEO"),
    )!.data as Record<string, unknown>;
    expect(data.wireManual).toBe(true);
    expect(data.canReset).toBe(true);
    expect(outputBindingOverridden(paramMap, "5::output::VIDEO", "T2I")).toBe(true);
  });

  it("显式断开：不画线（悬空本身就在说「没接」）", () => {
    const paramMap = applyOutputBindingEdit(null, {
      outputIoKey: "5::output::IMAGE",
      ioKey: null,
      mode: "T2I",
    });
    const { edges, resolved } = build(paramMap);
    expect(resolved["5::output::IMAGE"]).toBeNull();
    expect(edges).toHaveLength(0);
  });

  it("没有模式：卡片照画（可查看），但端点不可连线", () => {
    const { nodes } = build({}, null);
    expect(nodes.length).toBe(2);
    for (const node of nodes) {
      expect((node.data as Record<string, unknown>).canWire).toBe(false);
    }
  });

  it("宿主节点不在当前视图里 → 卡片与线都不产出（不留悬空节点）", () => {
    const { nodes, edges } = buildOutputWiring({
      io,
      outputs,
      paramMap: {},
      mode: "T2I",
      hostPosById: {},
      onReset: () => undefined,
    });
    expect(nodes).toHaveLength(0);
    expect(edges).toHaveLength(0);
  });

  it("另一个模式的覆盖不影响当前模式", () => {
    const paramMap = applyOutputBindingEdit(null, {
      outputIoKey: "5::output::IMAGE",
      ioKey: "5::output::VIDEO",
      mode: "T2V",
    });
    const { edges } = build(paramMap, "T2I");
    expect(edges[0]!.sourceHandle).toBe("5::output::IMAGE");
  });
});

describe("输出连线闸门", () => {
  it("宿主输出行 → 输出卡片：合法（两个方向都认）", () => {
    expect(
      isValidOutputConnection(
        {
          source: "5",
          sourceHandle: "5::output::IMAGE",
          target: outputNodeId("5::output::VIDEO"),
          targetHandle: "5::output::VIDEO",
        },
        io,
      ),
    ).toBe(true);
    /* 反向拖同样受理（React Flow 不保证连线方向）。 */
    expect(
      isValidOutputConnection(
        {
          source: outputNodeId("5::output::VIDEO"),
          sourceHandle: "5::output::VIDEO",
          target: "5",
          targetHandle: "5::output::IMAGE",
        },
        io,
      ),
    ).toBe(true);
  });

  it("落在**输入**行上：拒绝（输入行不是产出，从它读不到东西）", () => {
    /* 卡片在 target 端 → 另一端（source）是落点。 */
    expect(
      isValidOutputConnection(
        {
          source: "5",
          sourceHandle: "5::widget::text",
          target: outputNodeId("5::output::VIDEO"),
          targetHandle: "5::output::VIDEO",
        },
        io,
      ),
    ).toBe(false);
    /* 卡片在 source 端（反向拖）→ 另一端（target）是落点。 */
    expect(
      isValidOutputConnection(
        {
          source: outputNodeId("5::output::VIDEO"),
          sourceHandle: "5::output::VIDEO",
          target: "5",
          targetHandle: "5::widget::text",
        },
        io,
      ),
    ).toBe(false);
  });

  it("两张卡片之间 / 图上普通连线：都不是这条通道的线", () => {
    expect(
      isValidOutputConnection(
        {
          source: outputNodeId("5::output::IMAGE"),
          target: outputNodeId("5::output::VIDEO"),
        },
        io,
      ),
    ).toBe(false);
    expect(
      isValidOutputConnection({ source: "5", target: "6" }, io),
    ).toBe(false);
  });
});
