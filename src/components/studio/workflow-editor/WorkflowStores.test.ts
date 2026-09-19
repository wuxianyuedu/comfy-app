/**
 * IOEdit store —— 勾选写入的字段 + 作者改名。
 *
 * · 勾选写入（`toggleIO`）：只记**身份字段**（direction / kind / nodeId /
 *   name / hostNodeId）。下钻到子工作流内部勾选时，画布会把当前视图的宿主
 *   （外层封装）节点 id 一并带上 —— 运行期 comfy-cli 展开子图后的节点 id 是
 *   `宿主id:内部id`，只有把两个 id 都存下来才能确定性还原。画布透传的
 *   **显示名不落库**：它本来就是画布从同一个 raw 槽位读出来的名字。
 * · 作者改名（`setIOLabel`）：`label` 的唯一写入点，写什么存什么。
 *   旧版那套「勾选抄名字进库 → 再按机器名判定让位 / 清掉」的机制随根因一起
 *   删除（ISSUE #349），所以这里守的是「写入路径不改写作者命名」。
 */
import { describe, expect, it, vi } from "vitest";

import {
  callStoreAction,
  createIOEditStore,
  type IOEditStore,
} from "./WorkflowStores";
import {
  registerStaleStoreDeliver,
  reportCodeUpdatedSinceLoad,
  resetStaleStoreNotify,
} from "~/lib/shell/stale-store-notify";

describe("IOEditStore.toggleIO", () => {
  it("顶层勾选只记身份字段（显示名由 IoRef 类型挡在外面）", () => {
    const store = createIOEditStore("wf");
    store.getState().toggleIO({
      nodeId: "24",
      name: "image",
      kind: "widget",
      direction: "input",
    });
    const entry = store.getState().workflowIO["24::widget::image"]!;
    expect(entry.hostNodeId).toBeUndefined();
    /* 显示名不进库 —— 由富化链 / 作者改名一处给（ISSUE #349 的根因）。 */
    expect(entry.label).toBeUndefined();
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
    expect(store.getState().workflowIO["1670::widget::value"]!.hostNodeId).toBe(
      "4",
    );
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

describe("IOEditStore 写入路径不改写作者命名", () => {
  const KEY = "4::widget::value_1";

  /** 勾选一条 wrapper 槽位，再按作者改名（勾选本身不带任何显示名）。 */
  function storeWithRenamedSeed() {
    const store = createIOEditStore("wf");
    store.getState().toggleIO({
      nodeId: "4",
      name: "value_1",
      kind: "widget",
      direction: "input",
    });
    store.getState().setIOLabel(KEY, "我的种子");
    return store;
  }

  it("切 seed 模式（写 modes）不改写作者命名", () => {
    const store = storeWithRenamedSeed();
    store.getState().setIOModeOverride(KEY, "i2v", { seedMode: "random" });
    const entry = store.getState().workflowIO[KEY]!;
    expect(entry.label).toBe("我的种子");
    expect(entry.modeOverrides?.i2v?.seedMode).toBe("random");
  });

  it("改「必填」不改写作者命名", () => {
    const store = storeWithRenamedSeed();
    store.getState().toggleIORequired(KEY);
    expect(store.getState().workflowIO[KEY]!.label).toBe("我的种子");
  });

  it("取消勾选再重新勾选不会复活任何显示名", () => {
    const store = createIOEditStore("wf");
    const ref = {
      nodeId: "4",
      name: "value_1",
      kind: "widget" as const,
      direction: "input" as const,
    };
    store.getState().toggleIO(ref);
    store.getState().toggleIO(ref);
    store.getState().toggleIO(ref);
    expect(store.getState().workflowIO[KEY]!.label).toBeUndefined();
  });

  it("改名成与 pin 名逐字相同的名字也留得住（图三「修改了也不行」）", () => {
    const store = createIOEditStore("wf");
    store.getState().toggleIO({
      nodeId: "24",
      name: "image",
      kind: "widget",
      direction: "input",
    });
    store.getState().setIOLabel("24::widget::image", "image");
    expect(store.getState().workflowIO["24::widget::image"]!.label).toBe(
      "image",
    );
  });

  it("清空改名 = 恢复默认显示名", () => {
    const store = createIOEditStore("wf");
    store.getState().toggleIO({
      nodeId: "24",
      name: "image",
      kind: "widget",
      direction: "input",
    });
    store.getState().setIOLabel("24::widget::image", "尾帧图");
    store.getState().setIOLabel("24::widget::image", "  ");
    expect(
      store.getState().workflowIO["24::widget::image"]!.label,
    ).toBeUndefined();
  });
});

describe("IOEditStore 编辑模式与预览的开关耦合（ISSUE #400）", () => {
  it("关闭编辑模式时一并关闭 IO 预览", () => {
    const store = createIOEditStore("wf");
    store.getState().setIoEditMode(true);
    store.getState().setIoPreviewOpen(true);

    store.getState().setIoEditMode(false);

    expect(store.getState().ioEditMode).toBe(false);
    expect(store.getState().ioPreviewOpen).toBe(false);
  });

  it("开启编辑模式不动预览开关（预览本来就关着就保持关着）", () => {
    const store = createIOEditStore("wf");
    store.getState().setIoEditMode(true);
    expect(store.getState().ioPreviewOpen).toBe(false);
  });

  it("关闭预览时一并退出编辑模式（勾选框不该留在没有面板的画布上）", () => {
    const store = createIOEditStore("wf");
    store.getState().setIoEditMode(true);
    store.getState().setIoPreviewOpen(true);

    store.getState().setIoPreviewOpen(false);

    expect(store.getState().ioPreviewOpen).toBe(false);
    expect(store.getState().ioEditMode).toBe(false);
  });

  it("打开预览时一并进入编辑模式（勾选框要可用）", () => {
    const store = createIOEditStore("wf");
    store.getState().setIoPreviewOpen(true);
    expect(store.getState().ioPreviewOpen).toBe(true);
    expect(store.getState().ioEditMode).toBe(true);
  });

  it("关闭编辑模式不碰 IO 勾选结果（只关面板，不清选择）", () => {
    const store = createIOEditStore("wf");
    store.getState().toggleIO({
      nodeId: "24",
      name: "image",
      kind: "widget",
      direction: "input",
    });
    store.getState().setIoEditMode(false);
    expect(store.getState().workflowIO["24::widget::image"]).toBeDefined();
  });

  it("关闭预览同样不碰 IO 勾选结果", () => {
    const store = createIOEditStore("wf");
    store.getState().setIoPreviewOpen(true);
    store.getState().toggleIO({
      nodeId: "24",
      name: "image",
      kind: "widget",
      direction: "input",
    });
    store.getState().setIoPreviewOpen(false);
    expect(store.getState().workflowIO["24::widget::image"]).toBeDefined();
  });

  it("重复关闭预览不产生多余状态变更", () => {
    const store = createIOEditStore("wf");
    store.getState().setIoPreviewOpen(false);
    store.getState().setIoPreviewOpen(false);
    expect(store.getState().ioEditMode).toBe(false);
    expect(store.getState().ioPreviewOpen).toBe(false);
  });

  it("本来就是关的：重复关闭不产生多余状态变更", () => {
    const store = createIOEditStore("wf");
    const before = store.getState();
    store.getState().setIoEditMode(false);
    store.getState().setIoEditMode(false);
    expect(store.getState().ioEditMode).toBe(before.ioEditMode);
    expect(store.getState().ioPreviewOpen).toBe(false);
  });
});

describe("callStoreAction", () => {
  it("动作存在时正常调用并返回 true", () => {
    const store = createIOEditStore("wf");
    const key = "4::widget::value_1";
    store.setState({
      workflowIO: {
        [key]: {
          direction: "input",
          kind: "widget",
          nodeId: "4",
          name: "value_1",
        },
      },
    });
    const ok = callStoreAction(store, "toggleIORequired", (state) =>
      state.toggleIORequired(key),
    );
    expect(ok).toBe(true);
    expect(store.getState().workflowIO[key]!.required).toBe(true);
  });

  it("动作缺失时降级不抛错 —— 热更新后未重载的陈旧实例", () => {
    const store = createIOEditStore("wf");
    /* 模拟旧实例：动作集合比当前模块少成员（旧窗口里 setIOValues /
     *  resetIOPreviewValues 这类已删动作还在调用点，新实例上则已经不存在）。 */
    const stale = {
      getState: () => ({}) as unknown as IOEditStore,
    } as unknown as Parameters<typeof callStoreAction<IOEditStore>>[0];
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      expect(() =>
        callStoreAction(stale, "toggleIORequired", () => undefined),
      ).not.toThrow();
      expect(warn).toHaveBeenCalledOnce();
      /* 正常实例不受影响。 */
      expect(callStoreAction(store, "toggleIORequired", () => undefined)).toBe(
        true,
      );
    } finally {
      warn.mockRestore();
    }
  });

  /* 降级不能是静默的：跳过调用只保住了「不白屏」，用户看到的是功能悄悄失效。
   * 这里锁住「降级时顺手把事实交给通知通道」这条接线（去重与文案在通知层，
   * 见 ~/lib/stale-store-notify 的用例）。 */
  it("动作缺失时把「陈旧实例」事实交给通知通道", () => {
    const deliveries: { title: string }[] = [];
    registerStaleStoreDeliver((n) => deliveries.push(n));
    reportCodeUpdatedSinceLoad();
    const stale = {
      getState: () => ({}) as unknown as IOEditStore,
    } as unknown as Parameters<typeof callStoreAction<IOEditStore>>[0];
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      callStoreAction(stale, "toggleIORequired", () => undefined);
      expect(deliveries).toHaveLength(1);
      expect(deliveries[0]!.title).toContain("重载");
    } finally {
      warn.mockRestore();
      resetStaleStoreNotify();
    }
  });
});
