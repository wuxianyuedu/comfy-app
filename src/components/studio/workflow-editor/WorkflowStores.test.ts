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
    /* 富化下发基准：「该条目现在的原始槽位名是 value_1」，且富化链现在给出的
     *  显示名是作者名 `Seed`。 */
    store.getState().setAliasBase({
      "4::widget::value_1": { name: "value_1", enrichedLabel: "Seed" },
    });
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
    store.getState().setAliasBase({ a: { name: "seed" } });
    const first = store.getState().aliasBaseByKey;
    store.getState().setAliasBase({ a: { name: "seed" } });
    expect(store.getState().aliasBaseByKey).toBe(first);
  });

  it("基准对象逐键等价时也算「没变」（值对象每帧重建，不能浅比引用）", () => {
    const store = createIOEditStore("wf");
    store.getState().setAliasBase({ a: { name: "seed", slotLabel: "Seed" } });
    const first = store.getState().aliasBaseByKey;
    store.getState().setAliasBase({ a: { name: "seed", slotLabel: "Seed" } });
    expect(store.getState().aliasBaseByKey).toBe(first);
  });

  it("槽位名与本地名逐字相同的别名同样清得掉（ISSUE #349 的复现路径）", () => {
    /* 用户看到的 `value_1` 就是槽位名本身：修复前「本地名 === 槽位名」这条判据
     *  对它恒成立，等于没判，条目被当成作者命名留下；一切换 seed 行为，写入再把
     *  它固化回库，显示名随即退回 value_1。 */
    const store = createIOEditStore("wf");
    store
      .getState()
      .toggleIO({ nodeId: "4", name: "value_1", kind: "widget", direction: "input", label: "value_1" });
    store.getState().setAliasBase({
      "4::widget::value_1": { name: "value_1", enrichedLabel: "随机种", slotLabel: "Seed" },
    });
    store.getState().setIOModeOverride("4::widget::value_1", "i2v", { seedMode: "random" });
    const entry = store.getState().workflowIO["4::widget::value_1"]!;
    expect(entry.label).toBeUndefined();
    expect(entry.modes?.i2v?.seedMode).toBe("random");
  });

  it("本层有作者业务名但富化名也停在别名时，同样清得掉", () => {
    const store = createIOEditStore("wf");
    store
      .getState()
      .toggleIO({ nodeId: "4", name: "value_1", kind: "widget", direction: "input", label: "value_1" });
    store.getState().setAliasBase({
      "4::widget::value_1": { name: "value_1", enrichedLabel: "value_1", slotLabel: "Seed" },
    });
    store.getState().setIOModeOverride("4::widget::value_1", "i2v", { seedMode: "fixed" });
    expect(store.getState().workflowIO["4::widget::value_1"]!.label).toBeUndefined();
  });

  it("富化两个来源都只有别名时不动本地值（无从判定）", () => {
    const store = createIOEditStore("wf");
    store
      .getState()
      .toggleIO({ nodeId: "4", name: "value_1", kind: "widget", direction: "input", label: "value_1" });
    store.getState().setAliasBase({ "4::widget::value_1": { name: "value_1", enrichedLabel: "value_1" } });
    store.getState().setIOModeOverride("4::widget::value_1", "i2v", { seedMode: "fixed" });
    expect(store.getState().workflowIO["4::widget::value_1"]!.label).toBe("value_1");
  });
});
