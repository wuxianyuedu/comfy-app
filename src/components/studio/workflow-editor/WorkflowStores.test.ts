/**
 * IOEdit store —— 勾选写入的字段 + 存量机器名清理（ISSUE #349）。
 *
 * · 勾选写入：下钻到子工作流内部勾选时，画布会把当前视图的宿主（外层封装）
 *   节点 id 一并带上（`IoRef.hostNodeId`）。它必须随条目落库 —— 运行期
 *   comfy-cli 展开子图后的节点 id 是 `宿主id:内部id`，只有把两个 id 都存下来
 *   才能确定性还原。
 * · 清理：修复前勾选会把原始槽位名（`value_1` / `image`）固化成「作者命名」
 *   落库，让位给富化名的只是显示层；任何一次写入都会把它重新固化，显示名随即
 *   退回别名（切 seed 的随机值/固定值就是这个路径）。
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


describe("IOEditStore 写入时清掉存量机器名", () => {
  const seedEntry = {
    nodeId: "4",
    name: "value_1",
    kind: "widget" as const,
    direction: "input" as const,
    label: "value_1",
  };

  function storeWithSeed() {
    const store = createIOEditStore("wf");
    store.getState().toggleIO(seedEntry);
    /* 富化下发「该条目现在的原始槽位名是 value_1」。 */
    store.getState().setAliasBase({ "4::widget::value_1": "value_1" });
    return store;
  }

  it("切换 seed 模式时不再把 alias 固化回库", () => {
    const store = storeWithSeed();
    store.getState().setIOModeOverride("4::widget::value_1", "i2v", { seedMode: "random" });
    const entry = store.getState().workflowIO["4::widget::value_1"]!;
    expect(entry.label).toBeUndefined();
    expect(entry.modes?.i2v?.seedMode).toBe("random");
  });

  it("真正的作者命名不受影响", () => {
    const store = createIOEditStore("wf");
    store.getState().toggleIO(seedEntry);
    store.getState().setIOLabel("4::widget::value_1", "我的种子");
    store.getState().setIOModeOverride("4::widget::value_1", "i2v", { seedMode: "fixed" });
    expect(store.getState().workflowIO["4::widget::value_1"]!.label).toBe("我的种子");
  });

  it("基准还没到（富化未加载）时不做清理", () => {
    const store = createIOEditStore("wf");
    store.getState().toggleIO(seedEntry);
    store.getState().setIOModeOverride("4::widget::value_1", "i2v", { seedMode: "fixed" });
    expect(store.getState().workflowIO["4::widget::value_1"]!.label).toBe("value_1");
  });

  it("setAliasBase 内容不变时保持同一引用，避免渲染回路", () => {
    const store = createIOEditStore("wf");
    store.getState().setAliasBase({ a: "seed" });
    const first = store.getState().aliasBaseByKey;
    store.getState().setAliasBase({ a: "seed" });
    expect(store.getState().aliasBaseByKey).toBe(first);
  });
});
