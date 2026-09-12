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
import { describe, expect, it, vi } from "vitest";

import { callStoreAction, createIOEditStore, type IOEditStore } from "./WorkflowStores";
import { HOMONYM_LABEL_SUFFIX } from "./io-exposure";

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

  it("基准里的宿主类名参与等价判定（它是别名判据的一部分）", () => {
    const store = createIOEditStore("wf");
    store.getState().setAliasBase({ a: { name: "value_1", classType: "PrimitiveInt" } });
    const first = store.getState().aliasBaseByKey;
    store.getState().setAliasBase({
      a: { name: "value_1", classType: "e0940f57-80b2-480e-8a38-36968dc1763d" },
    });
    expect(store.getState().aliasBaseByKey).not.toBe(first);
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

  it("全库只有机器名一个来源、且宿主不是封装节点时不动本地值（无从判定）", () => {
    /* 普通节点的 pin 名由插件作者定义，可能恰好长成 value_1 —— 没有第二个
     *  来源时不能凭形状清掉它，那是作者命名（规范 §10.1 宁降级不误删）。 */
    const store = createIOEditStore("wf");
    store
      .getState()
      .toggleIO({ nodeId: "7", name: "value_1", kind: "widget", direction: "input", label: "value_1" });
    store.getState().setAliasBase({ "7::widget::value_1": { name: "value_1", enrichedLabel: "value_1" } });
    store.getState().setIOModeOverride("7::widget::value_1", "i2v", { seedMode: "fixed" });
    expect(store.getState().workflowIO["7::widget::value_1"]!.label).toBe("value_1");
  });

  it("作者名整体回收不到时，封装节点的自动编号槽位仍按机器名清掉", () => {
    /* 这条是「切一次 seed 行为名字就退回 value_1」在上一版修完后仍然复现的
     *  那个口子：子图导出里没有 `-10` 哨兵边、`proxyWidgets` 又被隔离，
     *  富化名与本层作者名都拿不到，只有「宿主是封装节点 + 槽位名是自动编号」
     *  这一条事实可依（ISSUE #349）。 */
    const store = createIOEditStore("wf");
    store.setState({
      workflowIO: {
        "4::widget::value_1": {
          direction: "input",
          kind: "widget",
          nodeId: "4",
          name: "value_1",
          label: "value_1",
        },
      },
    });
    store.getState().setAliasBase({
      "4::widget::value_1": {
        name: "value_1",
        enrichedLabel: "value_1",
        classType: "e0940f57-80b2-480e-8a38-36968dc1763d",
      },
    });
    store.getState().setIOModeOverride("4::widget::value_1", "i2v", { seedMode: "random" });
    const entry = store.getState().workflowIO["4::widget::value_1"]!;
    expect(entry.label).toBeUndefined();
    expect(entry.modes?.i2v?.seedMode).toBe("random");
  });

  it("重新勾选封装节点的别名槽位不会把机器名写进 label", () => {
    const store = createIOEditStore("wf");
    store.getState().setAliasBase({
      "4::widget::value_1": {
        name: "value_1",
        enrichedLabel: "value_1",
        classType: "e0940f57-80b2-480e-8a38-36968dc1763d",
      },
    });
    const ref = {
      nodeId: "4", name: "value_1", kind: "widget" as const, direction: "input" as const,
      label: "value_1",
    };
    store.getState().toggleIO(ref);
    expect(store.getState().workflowIO["4::widget::value_1"]!.label).toBeUndefined();
  });
});


/* ────────────────────────────────────────────────────────────────────────
 * ISSUE #349 收尾：编辑 IO 时「取消勾选 → 重新勾选」和「切模式」都不该让
 * 参数名退回机器名。用户原话：
 *   图1「切换不同模式，同一个参数名称不一致…是 seed 参数」
 *   图2/图4「只要取消 io 的勾选，对应参数名字的修改就应该还原」
 *   图3「改成了 1，而且修改了也不行」
 * 三条其实是同一个根因：本地条目里的 label 可能是机器 pin 名，而显示/写入
 * 判定依赖「我们记得写过脏值」—— 一旦重新加载（取消勾选再勾、重开工作流）
 * 记忆就没了，脏名复活。下面的用例守着「判定只看事实源」这条契约。
 * ──────────────────────────────────────────────────────────────────────── */
describe("IOEditStore 机器名的入口与出口都挡（ISSUE #349）", () => {
  const KEY = "4::widget::value_1";
  /* 图一那条工作流的事实：wrapper 槽位 value_1 → 内部 PrimitiveInt.value，
   * 富化名停在槽位名，作者名只有本层 slotLabel 能作证。 */
  const aliasBase = { [KEY]: { name: "value_1", enrichedLabel: "value_1", slotLabel: "Seed" } };

  it("勾选时不把机器名写进 label —— 所以取消勾选再勾选不会复活脏名", () => {
    const store = createIOEditStore("wf");
    store.getState().setAliasBase(aliasBase);
    const ref = {
      nodeId: "4", name: "value_1", kind: "widget" as const, direction: "input" as const,
      label: "value_1",
    };
    store.getState().toggleIO(ref);
    expect(store.getState().workflowIO[KEY]!.label).toBeUndefined();
    /* 取消勾选 → 重新勾选：本地已无任何记忆，仍不写入机器名。 */
    store.getState().toggleIO(ref);
    store.getState().toggleIO(ref);
    expect(store.getState().workflowIO[KEY]!.label).toBeUndefined();
  });

  it("勾选时作者真名照常落库（machine 判定不误伤业务名）", () => {
    const store = createIOEditStore("wf");
    store.getState().setAliasBase(aliasBase);
    store.getState().toggleIO({
      nodeId: "4", name: "value_1", kind: "widget", direction: "input", label: "Seed",
    });
    expect(store.getState().workflowIO[KEY]!.label).toBe("Seed");
  });

  it("重新加载后的旧条目（label 仍是脏值）切 seed 模式时被清掉", () => {
    /* 这是「重开工作流 → 切一下随机值 → 又变回 value_1」的复现路径：本地
     *  store 里躺的是回读时那份带脏 label 的条目，写入整体回写会把它当作者
     *  命名固化。判定必须只看事实源，不看本地记忆。 */
    const store = createIOEditStore("wf");
    store.setState({
      workflowIO: {
        [KEY]: { direction: "input", kind: "widget", nodeId: "4", name: "value_1", label: "value_1" },
      },
    });
    store.getState().setAliasBase(aliasBase);
    store.getState().setIOModeOverride(KEY, "i2v", { seedMode: "random" });
    const entry = store.getState().workflowIO[KEY]!;
    expect(entry.label).toBeUndefined();
    expect(entry.modes?.i2v?.seedMode).toBe("random");
  });

  it("富化名也停在机器名时，本层作者名是最后的判据", () => {
    /* 图一那条工作流的真实形状：富化链只能给出 `value_1`（本层确实没写作者
     *  label，只有通用翻译），但 `slotLabel` 记着本层槽位上的作者名 `Seed`。 */
    const store = createIOEditStore("wf");
    store.setState({
      workflowIO: {
        [KEY]: { direction: "input", kind: "widget", nodeId: "4", name: "value_1", label: "value_1" },
      },
    });
    store.getState().setAliasBase({ [KEY]: { name: "value_1", enrichedLabel: "value_1", slotLabel: "Seed" } });
    store.getState().setIOModeOverride(KEY, "i2v", { seedMode: "fixed" });
    expect(store.getState().workflowIO[KEY]!.label).toBeUndefined();
  });

  it("全库只有机器名一个来源时不动本地值（无从判定就不猜）", () => {
    const store = createIOEditStore("wf");
    store.setState({
      workflowIO: {
        [KEY]: { direction: "input", kind: "widget", nodeId: "4", name: "value_1", label: "value_1" },
      },
    });
    store.getState().setAliasBase({ [KEY]: { name: "value_1", enrichedLabel: "value_1" } });
    store.getState().setIOModeOverride(KEY, "i2v", { seedMode: "fixed" });
    expect(store.getState().workflowIO[KEY]!.label).toBe("value_1");
  });

  it("作者命名永不被写入路径清掉", () => {
    const store = createIOEditStore("wf");
    store.setState({
      workflowIO: {
        [KEY]: { direction: "input", kind: "widget", nodeId: "4", name: "value_1", label: "我的种子" },
      },
    });
    store.getState().setAliasBase(aliasBase);
    store.getState().setIOModeOverride(KEY, "i2v", { seedMode: "fixed" });
    expect(store.getState().workflowIO[KEY]!.label).toBe("我的种子");
  });

  it("改名成与 pin 名逐字相同的名字也留得住（图三「修改了也不行」）", () => {
    const store = createIOEditStore("wf");
    store.getState().toggleIO({
      nodeId: "24", name: "image", kind: "widget", direction: "input",
    });
    store.getState().setIOLabel("24::widget::image", "image");
    expect(store.getState().workflowIO["24::widget::image"]!.label).toBe(
      `image${HOMONYM_LABEL_SUFFIX}`
    );
  });

  it("清空改名 = 恢复默认显示名", () => {
    const store = createIOEditStore("wf");
    store.getState().toggleIO({
      nodeId: "24", name: "image", kind: "widget", direction: "input", label: "尾帧图",
    });
    store.getState().setIOLabel("24::widget::image", "  ");
    expect(store.getState().workflowIO["24::widget::image"]!.label).toBeUndefined();
  });

  it("purgeMachineNames 只在判定命中时产生新状态引用", () => {
    const store = createIOEditStore("wf");
    store.setState({
      workflowIO: {
        [KEY]: { direction: "input", kind: "widget", nodeId: "4", name: "value_1", label: "我的种子" },
      },
    });
    const before = store.getState().workflowIO;
    store.getState().purgeMachineNames(() => false);
    expect(store.getState().workflowIO).toBe(before);
    store.getState().purgeMachineNames(() => true);
    expect(store.getState().workflowIO[KEY]!.label).toBeUndefined();
  });
});

describe("callStoreAction", () => {
  it("动作存在时正常调用并返回 true", () => {
    const store = createIOEditStore("wf");
    const key = "4::widget::value_1";
    store.setState({
      workflowIO: {
        [key]: { direction: "input", kind: "widget", nodeId: "4", name: "value_1", label: "我的种子" },
      },
    });
    const ok = callStoreAction(store, "purgeMachineNames", (state) =>
      state.purgeMachineNames(() => true)
    );
    expect(ok).toBe(true);
    expect(store.getState().workflowIO[key]!.label).toBeUndefined();
  });

  it("动作缺失时降级不抛错 —— 热更新后未重载的陈旧实例", () => {
    const store = createIOEditStore("wf");
    /* 模拟旧实例：动作集合比当前模块少一个成员。 */
    const stale = {
      getState: () => ({}) as unknown as IOEditStore,
    } as unknown as Parameters<typeof callStoreAction<IOEditStore>>[0];
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      expect(() =>
        callStoreAction(stale, "purgeMachineNames", () => undefined)
      ).not.toThrow();
      expect(warn).toHaveBeenCalledOnce();
      /* 正常实例不受影响。 */
      expect(callStoreAction(store, "purgeMachineNames", () => undefined)).toBe(true);
    } finally {
      warn.mockRestore();
    }
  });
});
