// @vitest-environment jsdom
// 「应用服务断开 / 启动」记进消息中心这条链路的**接线**契约。
//
// 判据与文案在 `~/lib/shell/app-service-message` 的单测里逐分支钉死了；这里钉的是
// 三件只有接线才出问题的��
//   ① 边沿是从**上一次渲染**推进的（游标必须跨渲染存活，否则每拍都像首帧）；
//   ② 断开那一刻**不**发请求，原因要等「启动/恢复」那条现读再写（探活走的就是
//      应用服务自己的 HTTP，断开时那条端点必然不通）；
//   ③ 写出去的消息**带时刻与原因**，且读不到原因时仍然发出去（时间本身已是事实）。

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";

import { useMessageCenterStore } from "../message-center-store";
import { useAppServiceMessageLog } from "./use-app-service-message-log";

const EXIT_RECORD = {
  at: "2026-10-10T10:00:00.000Z",
  kind: "dev-server",
  code: 137,
  signal: null,
  reason: "Next.js dev server 提前退出（exit=137）",
  port: 3100,
  runId: "run-old",
};

/** 让 `/api/dev/last-exit` 回一份记录，并记录它被打了几次。 */
function stubExitEndpoint({
  record = EXIT_RECORD,
  currentRunId = "run-new",
  fail = false,
}: {
  record?: unknown;
  currentRunId?: string | null;
  fail?: boolean;
} = {}) {
  const calls = { lastExit: 0 };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      if (!url.includes("/api/dev/last-exit")) {
        return new Response("{}", { status: 404 });
      }
      calls.lastExit += 1;
      if (fail) throw new Error("network down");
      return new Response(JSON.stringify({ record, currentRunId }), {
        status: 200,
      });
    }),
  );
  return calls;
}

type Facts = {
  state: "starting" | "online" | "offline";
  processIsNew: boolean;
};

/** 挂上 hook 并返回「推进到某一拍」的函数。 */
function mount(initial: Facts) {
  return renderHook((props: Facts) => useAppServiceMessageLog(props), {
    initialProps: initial,
  });
}

function messages() {
  return useMessageCenterStore.getState().messages;
}

beforeEach(() => {
  useMessageCenterStore.setState({ open: false, messages: [] });
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("useAppServiceMessageLog：断开", () => {
  it("探活第一次不通时记一条「已断开」，带时刻", async () => {
    const calls = stubExitEndpoint();
    const { rerender } = mount({ state: "online", processIsNew: false });
    rerender({ state: "offline", processIsNew: false });

    expect(messages()).toHaveLength(1);
    expect(messages()[0]!.kind).toBe("offline");
    expect(messages()[0]!.title).toBe("应用服务已断开");
    expect(messages()[0]!.body).toContain("断开时间");
    /* 断开那一刻不去问原因——问的是那个已经不在的服务自己的端点。 */
    expect(calls.lastExit).toBe(0);
  });

  it("持续断开不重复发（2 秒一拍，逐拍发就是刷屏）", () => {
    stubExitEndpoint();
    const { rerender } = mount({ state: "online", processIsNew: false });
    rerender({ state: "offline", processIsNew: false });
    rerender({ state: "offline", processIsNew: false });
    rerender({ state: "offline", processIsNew: false });
    expect(messages()).toHaveLength(1);
  });
});

describe("useAppServiceMessageLog：启动 / 恢复", () => {
  it("冷启动：记一条「已重启」，带时刻与上一次结束的原因和建议", async () => {
    stubExitEndpoint();
    const { rerender } = mount({ state: "starting", processIsNew: false });
    rerender({ state: "online", processIsNew: true });

    await expect.poll(() => messages().length).toBe(1);
    const m = messages()[0]!;
    expect(m.kind).toBe("restart");
    expect(m.title).toBe("应用服务已重启");
    expect(m.body).toContain("自身退出");
    expect(m.body).toContain("137");
    /* 建议那一问是规范 §10.3.1 的硬要求：只讲「为什么」不够。 */
    expect(m.body).toContain("建议：");
    expect(m.time).toBeGreaterThan(0);
  });

  it("断开之后恢复：一条「已恢复」，同时带断开时间、恢复时间与持续时长", async () => {
    stubExitEndpoint();
    const { rerender } = mount({ state: "online", processIsNew: false });
    rerender({ state: "offline", processIsNew: false });
    rerender({ state: "online", processIsNew: false });

    await expect.poll(() => messages().length).toBe(2);
    const recovered = messages()[0]!;
    expect(recovered.kind).toBe("restart");
    expect(recovered.title).toBe("应用服务已恢复");
    expect(recovered.body).toContain("断开");
    expect(recovered.body).toContain("持续 ");
    expect(recovered.body).toContain("自身退出");
    /* 断开那条仍在（两条是同一件事的两个时刻，不是重复）。 */
    expect(messages()[1]!.title).toBe("应用服务已断开");
  });

  it("整页刷新（进程没换新）不发任何消息", () => {
    stubExitEndpoint();
    const { rerender } = mount({ state: "online", processIsNew: true });
    rerender({ state: "online", processIsNew: true });
    rerender({ state: "online", processIsNew: true });
    expect(messages()).toHaveLength(0);
  });

  it("进程换新（探活没失败过的那种快速重启）仍记一条，不靠「断开」这条边沿", async () => {
    stubExitEndpoint();
    const { rerender } = mount({ state: "online", processIsNew: false });
    /* 真→假→真：重启之后判据要重新走一遍「这份进程是新的」。 */
    rerender({ state: "online", processIsNew: false });
    rerender({ state: "online", processIsNew: true });

    await expect.poll(() => messages().length).toBe(1);
    expect(messages()[0]!.kind).toBe("restart");
  });
});

describe("useAppServiceMessageLog：原因读不到时", () => {
  it("端点挂了：仍然发消息，并说明没读到原因（不编一个，也不整条吞掉）", async () => {
    stubExitEndpoint({ fail: true });
    const { rerender } = mount({ state: "starting", processIsNew: false });
    rerender({ state: "online", processIsNew: true });

    await expect.poll(() => messages().length).toBe(1);
    expect(messages()[0]!.title).toBe("应用服务已启动");
    expect(messages()[0]!.body).toContain("没读到上一次结束的原因");
  });

  it("端点没记录（record: null）→ 按「没有原因可讲」发", async () => {
    stubExitEndpoint({ record: null });
    const { rerender } = mount({ state: "starting", processIsNew: false });
    rerender({ state: "online", processIsNew: true });

    await expect.poll(() => messages().length).toBe(1);
    expect(messages()[0]!.body).toContain("没读到上一次结束的原因");
  });

  it("记录说的就是当前这份进程（runId 相同）→ 不拿它当「上一次结束」", async () => {
    stubExitEndpoint({ record: { ...EXIT_RECORD, runId: "run-new" } });
    const { rerender } = mount({ state: "starting", processIsNew: false });
    rerender({ state: "online", processIsNew: true });

    await expect.poll(() => messages().length).toBe(1);
    expect(messages()[0]!.body).toContain("没读到上一次结束的原因");
    expect(messages()[0]!.body).not.toContain("自身退出");
  });

  it("取回之前就卸载 → 不留下消息（一个已消失的 watcher 不该触发全局通知）", async () => {
    /* 端点**挂起**直到用例亲手 resolve：只有这样「卸载」与「应答回来」的先后
     * 才是被排好的确定顺序。立刻 resolve 的 fetch 会在同一轮微任务里把消息写
     * 掉，测不到卸载守卫；等真实时钟又只是赌时间（§11.14 的裸 sleep 棘轮）。 */
    let release: ((res: Response) => void) | null = null;
    const requested = { done: false };
    vi.stubGlobal(
      "fetch",
      vi.fn(() => {
        requested.done = true;
        return new Promise<Response>((resolve) => {
          release = resolve;
        });
      }),
    );

    const { rerender, unmount } = mount({
      state: "starting",
      processIsNew: false,
    });
    rerender({ state: "online", processIsNew: true });
    /* 等「请求确实发出去了」这个**事实**（而不是等一段时间）：没发出去就卸载
     * 的话，这条用例根本没测到想测的东西。 */
    await expect.poll(() => requested.done).toBe(true);

    unmount();
    /* 应答在卸载之后才回来：`act` 的异步形态负责把这条 await 链与它之后的
     * React 提交一起排空，不需要挂钟。 */
    await act(async () => {
      release?.(
        new Response(
          JSON.stringify({ record: EXIT_RECORD, currentRunId: "run-new" }),
          {
            status: 200,
          },
        ),
      );
    });
    expect(messages()).toHaveLength(0);
  });
});
