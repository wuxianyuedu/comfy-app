// @vitest-environment jsdom
// 消息中心的**持久化**契约（判据与文案的用例不在这里，见同目录其他两份）。
//
// 为什么消息中心要有持久化：它记的恰恰是「应用服务断开 / 启动」，而这两件事的
// 观察窗口**覆盖一次整页刷新**——应用服务重启会让页面重载，纯内存的消息随之归零，
// 于是用户回到应用点开铃铛看到空的，只能得出「记了但没生效」的结论。这份用例钉住
// 「刷新之后还查得到」，以及坏数据不会把面板整个打不开。

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { MESSAGE_CENTER_STORAGE_KEY, useMessageCenterStore } from "./message-center-store";

/** 造一条可用的持久化记录（字段与 `MessageRecord` 一致）。 */
function record(overrides: Record<string, unknown> = {}) {
  return {
    id: "msg_1-1",
    kind: "restart",
    title: "应用服务已恢复",
    body: "正文",
    time: 1_760_000_000_000,
    read: true,
    ...overrides,
  };
}

function stored(): unknown {
  const raw = window.localStorage.getItem(MESSAGE_CENTER_STORAGE_KEY);
  return raw === null ? null : JSON.parse(raw);
}

beforeEach(() => {
  window.localStorage.clear();
  useMessageCenterStore.setState({
    open: false,
    messages: [],
    hydrated: false,
    currentRunId: null,
  });
});

afterEach(() => {
  window.localStorage.clear();
});

describe("消息中心持久化：写", () => {
  it("push 出来的消息落盘（含时刻与已读态）", () => {
    useMessageCenterStore
      .getState()
      .push({ kind: "offline", title: "应用服务已断开", body: "正文" });
    /* SAFETY: 类型断言已复核 */
    const list = stored() as Array<ReturnType<typeof record>>;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      kind: "offline",
      title: "应用服务已断开",
      read: false,
    });
    expect(list[0]!.time).toBeGreaterThan(0);
  });

  it("clear 之后落盘的是空列表（不留旧消息的残影）", () => {
    useMessageCenterStore.getState().push({ kind: "info", title: "A", body: "a" });
    useMessageCenterStore.getState().clear();
    expect(stored()).toEqual([]);
  });

  it("开关面板不碰存储（只有消息变化才写）", () => {
    useMessageCenterStore.getState().push({ kind: "info", title: "A", body: "a" });
    const before = window.localStorage.getItem(MESSAGE_CENTER_STORAGE_KEY);
    useMessageCenterStore.getState().setOpen(true);
    useMessageCenterStore.getState().toggleOpen();
    expect(window.localStorage.getItem(MESSAGE_CENTER_STORAGE_KEY)).toBe(before);
  });
});

describe("消息中心持久化：恢复", () => {
  it("hydrate 把上次留下的消息读回来（模拟刷新后重新挂载）", () => {
    window.localStorage.setItem(
      MESSAGE_CENTER_STORAGE_KEY,
      JSON.stringify([record({ id: "msg_a", title: "旧的那条" })]),
    );
    useMessageCenterStore.getState().hydrate();
    const { messages, hydrated } = useMessageCenterStore.getState();
    expect(hydrated).toBe(true);
    expect(messages).toHaveLength(1);
    expect(messages[0]!.title).toBe("旧的那条");
    expect(messages[0]!.read).toBe(true);
  });

  it("内存里已有同样内容时不重复替换（避免空跑一次渲染）", () => {
    window.localStorage.setItem(
      MESSAGE_CENTER_STORAGE_KEY,
      JSON.stringify([record({ id: "msg_a" })]),
    );
    useMessageCenterStore.getState().hydrate();
    const first = useMessageCenterStore.getState().messages;
    useMessageCenterStore.getState().hydrate();
    /* 同一个引用 = 恢复判定认为「已经是这份了」，没有另建一份。 */
    expect(useMessageCenterStore.getState().messages).toBe(first);
  });

  it("没存过 → 恢复后仍是空，不抛错", () => {
    expect(() => {
      useMessageCenterStore.getState().hydrate();
    }).not.toThrow();
    expect(useMessageCenterStore.getState().messages).toEqual([]);
  });

  it("存的是坏 JSON → 当作没存过（面板仍打得开）", () => {
    window.localStorage.setItem(MESSAGE_CENTER_STORAGE_KEY, "{不是 JSON");
    expect(() => {
      useMessageCenterStore.getState().hydrate();
    }).not.toThrow();
    expect(useMessageCenterStore.getState().messages).toEqual([]);
  });

  it("不是数组（有人把键改成了对象）→ 同样当没存过", () => {
    window.localStorage.setItem(MESSAGE_CENTER_STORAGE_KEY, JSON.stringify({ a: 1 }));
    useMessageCenterStore.getState().hydrate();
    expect(useMessageCenterStore.getState().messages).toEqual([]);
  });

  it("逐条校验：坏的那条被丢掉，好的照常恢复", () => {
    window.localStorage.setItem(
      MESSAGE_CENTER_STORAGE_KEY,
      JSON.stringify([
        record({ id: "msg_ok1" }),
        { id: "msg_bad1" }, // 缺 title / body / time / read
        record({ id: "msg_bad2", kind: "some-future-kind" }), // 不认识的档位
        record({ id: "msg_bad3", time: "不是数字" }),
        record({ id: "msg_ok2" }),
      ]),
    );
    useMessageCenterStore.getState().hydrate();
    const { messages } = useMessageCenterStore.getState();
    expect(messages.map((m) => m.id)).toEqual(["msg_ok1", "msg_ok2"]);
  });

  it("存了超过上限的条数 → 恢复时按上限裁剪（不被一份坏存储撑爆面板）", () => {
    window.localStorage.setItem(
      MESSAGE_CENTER_STORAGE_KEY,
      JSON.stringify(Array.from({ length: 250 }, (_, i) => record({ id: `msg_${i}` }))),
    );
    useMessageCenterStore.getState().hydrate();
    expect(useMessageCenterStore.getState().messages).toHaveLength(200);
  });
});

describe("消息中心持久化：启动戳（runId）", () => {
  /* 多次启动的记录此前混成一列平铺，面板按 runId 分组（判据见
   * `~/lib/shell/message-run-groups`）。runId 必须**活过一次刷新**——面板记的
   * 恰恰是故障，而应用服务重启会让页面重载，戳没了就等于每次刷新都退回「混在一起」。 */

  it("push 盖上当前启动并随消息落盘（刷新后仍能分组）", () => {
    useMessageCenterStore.getState().setCurrentRunId("a1b2c3");
    useMessageCenterStore
      .getState()
      .push({ kind: "offline", title: "应用服务已断开", body: "正文" });

    const { messages } = useMessageCenterStore.getState();
    expect(messages[0]!.runId).toBe("a1b2c3");
    expect(stored()).toMatchObject([{ runId: "a1b2c3" }]);
  });

  it("显式传了 runId 就用那个（不拿 currentRunId 覆盖）", () => {
    useMessageCenterStore.getState().setCurrentRunId("a1b2c3");
    useMessageCenterStore
      .getState()
      .push({ kind: "offline", title: "T", body: "b", runId: "old001" });
    expect(useMessageCenterStore.getState().messages[0]!.runId).toBe("old001");
  });

  it("显式传 `runId: null` 留 null（明确不知道 ≠ 没提供，不许补成当前启动）", () => {
    /* 这两者的区别就是上一条注释里说的那句：补成当前启动等于断言「它属于现在
     * 这次启动」——而面板正是拿它分组的，断言错了就是把两次启动并成一次。 */
    useMessageCenterStore.getState().setCurrentRunId("a1b2c3");
    useMessageCenterStore.getState().push({ kind: "offline", title: "T", body: "b", runId: null });
    expect(useMessageCenterStore.getState().messages[0]!.runId).toBeNull();
  });

  it("升级前写入的历史消息没有 runId → 读回按 null（不丢整条，也不猜它属于哪次）", () => {
    window.localStorage.setItem(
      MESSAGE_CENTER_STORAGE_KEY,
      JSON.stringify([record({ id: "msg_legacy", title: "老消息" })]),
    );
    useMessageCenterStore.getState().hydrate();
    const { messages } = useMessageCenterStore.getState();
    expect(messages).toHaveLength(1);
    expect(messages[0]!.runId).toBeNull();
  });

  it("currentRunId 是运行时事实，**不**落盘（刷新后由探活链路重新学到）", () => {
    useMessageCenterStore.getState().setCurrentRunId("a1b2c3");
    useMessageCenterStore.getState().push({ kind: "info", title: "A", body: "a" });
    const raw = window.localStorage.getItem(MESSAGE_CENTER_STORAGE_KEY) ?? "";
    expect(raw).not.toContain("currentRunId");
  });
});
