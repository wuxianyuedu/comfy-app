/**
 * IOEdit store —— 勾选写入的字段（ISSUE #349 后续）。
 *
 * 下钻到子工作流内部勾选时，画布会把当前视图的宿主（外层封装）节点 id 一并
 * 带上（`IoRef.hostNodeId`）。它必须随条目落库 —— 运行期 comfy-cli 展开子图后
 * 的节点 id 是 `宿主id:内部id`，只有把两个 id 都存下来才能确定性还原。
 */
import { describe, expect, it } from "vitest";

import { createIOEditStore } from "./WorkflowStores";

describe("IOEditStore.toggleIO", () => {
  it("顶层勾选不写 hostNodeId", () => {
    const store = createIOEditStore("wf");
    store.getState().toggleIO({
      nodeId: "24",
      name: "image",
      kind: "widget",
      direction: "input",
      label: "尾帧图",
    });
    const entry = store.getState().workflowIO["24::widget::image"]!;
    expect(entry.hostNodeId).toBeUndefined();
    expect(entry.label).toBe("尾帧图");
  });

  it("子图内部勾选把宿主 id 一起落库", () => {
    const store = createIOEditStore("wf");
    store.getState().toggleIO({
      nodeId: "1670",
      hostNodeId: "4",
      name: "value",
      kind: "widget",
      direction: "input",
    });
    expect(store.getState().workflowIO["1670::widget::value"]!.hostNodeId).toBe("4");
  });

  it("再次勾选同一 pin 时整体摘掉条目", () => {
    const store = createIOEditStore("wf");
    const ref = {
      nodeId: "1670",
      hostNodeId: "4",
      name: "value",
      kind: "widget" as const,
      direction: "input" as const,
    };
    store.getState().toggleIO(ref);
    store.getState().toggleIO(ref);
    expect(store.getState().workflowIO["1670::widget::value"]).toBeUndefined();
  });
});
