// @vitest-environment jsdom
// 「应用服务断开 / 启动」记进消息中心这条链路的**接线**契约。
//
// 判据与文案在 `~/lib/shell/app-service-message` 的单测里逐分支钉死了；这里钉的是
// 三件只有接线才出问题的事：
//   ① 边沿是从**上一次渲染**推进的（游标必须跨渲染存活，否则每拍都像首帧）；
//   ② 断开那一刻的原因**走壳的 IPC** 读（`get_app_service_exit`，ISSUE #1915）——
//      经 HTTP 那条端点由没了的那个服务自己应答，此刻必然不通；恢复那条才走 HTTP；
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

/**
 * 让壳那条存活通道（`~/lib/shell/desktop-shell-client` 的 `readAppServiceExitRecord`，
 * 底层是壳命令 `get_app_service_exit`）回一份**记录原文**。
 *
 * 这个模块被 mock 掉是**为了能摆「壳内有这条通道」这一档**：jsdom 里
 * `isDesktopShell()` 为假，真实实现自己会回 null（浏览器形态的真实样子），
 * 那样就测不到「断开那一刻当场带上原因」。每个用例开始时它被重置回 null，
 * 于是缺省形态仍是浏览器那一档。
 */
const shell = vi.hoisted(() => ({
  readAppServiceExitRecord: vi.fn(async (): Promise<string | null> => null),
}));
vi.mock("~/lib/shell/desktop-shell-client", () => ({
  readAppServiceExitRecord: shell.readAppServiceExitRecord,
}));

function stubShellExitRecord(record: unknown = EXIT_RECORD) {
  shell.readAppServiceExitRecord.mockResolvedValue(
    record === null ? null : JSON.stringify(record),
  );
}

type Facts = {
  state: "starting" | "online" | "offline" | "stale";
  processIsNew: boolean;
  /** 当前是哪一次启动（runId）；null = 拿不到（手工 `pnpm dev` 等）。 */
  currentRunId: string | null;
  /** 最后一拍之前**没人在探测**的那一段（毫秒）；省缺 0（每一拍都在探）。 */
  unprobedMs: number;
};

/** 缺省启动标识：绝大多数用例不关心它，而它又是必填的——不填就等于「拿不到启动
 *  标识」，消息会落到「未标记启动」那一组，分组断言就什么都不剩了。 */
const DEFAULT_RUN_ID = "a1b2c3";

/**
 * 挂上 hook 并返回「推进到某一拍」的函数。
 *
 * `rerender` 收**部分事实**并与上一拍合并（`renderHook` 的 rerender 是整体替换，
 * 而这里几乎每个用例都只改一个字段）；缺省字段取 `DEFAULT_RUN_ID` 那一档。
 */
function mount(initial: Partial<Facts> = {}) {
  let cur: Facts = {
    state: "starting",
    processIsNew: false,
    currentRunId: DEFAULT_RUN_ID,
    unprobedMs: 0,
    ...initial,
  };
  const r = renderHook((props: Facts) => useAppServiceMessageLog(props), {
    initialProps: cur,
  });
  return {
    ...r,
    rerender: (next: Partial<Facts>) => {
      cur = { ...cur, ...next };
      r.rerender(cur);
    },
  };
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
  /* 壳通道默认「没有」（浏览器形态）：每个用例自己决定要不要 stub 成有。 */
  shell.readAppServiceExitRecord.mockReset();
  shell.readAppServiceExitRecord.mockResolvedValue(null);
});

describe("useAppServiceMessageLog：断开", () => {
  it("探活第一次不通时记一条「已断开」，带时刻", async () => {
    const calls = stubExitEndpoint();
    const { rerender } = mount({ state: "online", processIsNew: false });
    rerender({ state: "offline", processIsNew: false });

    await expect.poll(() => messages().length).toBe(1);
    expect(messages()[0]!.kind).toBe("offline");
    expect(messages()[0]!.title).toBe("应用服务已断开");
    expect(messages()[0]!.body).toContain("断开时间");
    /* 断开那一刻**不走 HTTP**：那条端点由没了的那个服务自己应答，此刻必然不通。 */
    expect(calls.lastExit).toBe(0);
  });

  it("壳内断开：当场把原因写进断开那条（ISSUE #1915——原因早就在盘上，别再等恢复）", async () => {
    stubExitEndpoint();
    stubShellExitRecord({ ...EXIT_RECORD, runId: DEFAULT_RUN_ID });
    const { rerender } = mount({
      state: "online",
      processIsNew: false,
      currentRunId: DEFAULT_RUN_ID,
    });
    rerender({ state: "offline", processIsNew: false });

    await expect.poll(() => messages().length).toBe(1);
    const m = messages()[0]!;
    expect(m.title).toBe("应用服务已断开");
    expect(m.body).toContain("原因：");
    expect(m.body).toContain("137");
    expect(m.body).toContain("建议：");
  });

  it("盘上留的是更早那一次的记录 → 不拿它当这一次断开的原因", async () => {
    stubExitEndpoint();
    stubShellExitRecord({ ...EXIT_RECORD, runId: "another-run" });
    const { rerender } = mount({
      state: "online",
      processIsNew: false,
      currentRunId: DEFAULT_RUN_ID,
    });
    rerender({ state: "offline", processIsNew: false });

    await expect.poll(() => messages().length).toBe(1);
    expect(messages()[0]!.body).not.toContain("原因：");
  });

  it("持续断开不重复发（2 秒一拍，逐拍发就是刷屏）", async () => {
    stubExitEndpoint();
    const { rerender } = mount({ state: "online", processIsNew: false });
    rerender({ state: "offline", processIsNew: false });
    rerender({ state: "offline", processIsNew: false });
    rerender({ state: "offline", processIsNew: false });
    await expect.poll(() => messages().length).toBe(1);
  });
});

describe("useAppServiceMessageLog：路由表不完整", () => {
  it("进入 stale 记一条「路由异常」，正文给出重启应用这个出口", () => {
    stubExitEndpoint();
    const { rerender } = mount({ state: "online", processIsNew: false });
    rerender({ state: "stale", processIsNew: false });

    const last = messages().at(-1)!;
    expect(last.title).toBe("应用服务路由异常");
    expect(last.body).toContain("重新启动");
    /* 服务还在应答，所以这条挂的是**当前这次启动**的 runId（与断开那条相反）。 */
    expect(last.runId).toBe(DEFAULT_RUN_ID);
  });

  it("持续 stale 不重复发，且不冒充「已断开」", () => {
    stubExitEndpoint();
    const { rerender } = mount({ state: "online", processIsNew: false });
    rerender({ state: "stale", processIsNew: false });
    rerender({ state: "stale", processIsNew: false });
    const stale = messages().filter((m) => m.title === "应用服务路由异常");
    expect(stale).toHaveLength(1);
    expect(messages().some((m) => m.title === "应用服务已断开")).toBe(false);
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
    /* 只 fake `Date`、不碰定时器：两条边沿必须落在**不同时刻**，否则「哪条在
     * 前」测的就不是因果而是排序的稳定性（真实现场里两拍至少隔 4 秒）。 */
    const base = Date.now();
    vi.useFakeTimers({ toFake: ["Date"] });
    const { rerender } = mount({ state: "online", processIsNew: false });
    vi.setSystemTime(base + 1_000);
    rerender({ state: "offline", processIsNew: false });
    vi.setSystemTime(base + 10_000);
    rerender({ state: "online", processIsNew: false });
    vi.useRealTimers();

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

  it("恢复那条把「停表那一段」如实标注出来（A：探活暂停期间墙钟照走）", async () => {
    stubExitEndpoint({ record: null });
    /* 只 fake `Date`：两条边沿要落在不同时刻，「持续」才有内容；停表那一段由
     * `unprobedMs` 单独给（它来自探活那一侧），这里只验接线把它递到文案。 */
    const base = Date.now();
    vi.useFakeTimers({ toFake: ["Date"] });
    const { rerender } = mount({ state: "online", processIsNew: false });
    vi.setSystemTime(base + 1_000);
    rerender({ state: "offline", processIsNew: false });
    vi.setSystemTime(base + 130_000);
    rerender({ state: "online", processIsNew: false, unprobedMs: 60_000 });
    vi.useRealTimers();

    await expect.poll(() => messages().length).toBe(2);
    const recovered = messages()[0]!;
    expect(recovered.title).toBe("应用服务已恢复");
    /* 时长照给（不减掉），另加一行说清那段没有探测。 */
    expect(recovered.body).toContain("持续 2 分 09 秒");
    expect(recovered.body).toContain("其中 1 分 00 秒 没有探测");
    expect(recovered.body).toContain("无从得知");
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
  it("端点挂了：仍然发消息，并说明这一次是什么（不编一个成因，也不整条吞掉）", async () => {
    stubExitEndpoint({ fail: true });
    const { rerender } = mount({ state: "starting", processIsNew: false });
    rerender({ state: "online", processIsNew: true });

    await expect.poll(() => messages().length).toBe(1);
    expect(messages()[0]!.title).toBe("应用服务已启动");
    expect(messages()[0]!.body).toContain("冷启动");
  });

  it("端点没记录（record: null）→ 按「没有原因可讲」发", async () => {
    stubExitEndpoint({ record: null });
    const { rerender } = mount({ state: "starting", processIsNew: false });
    rerender({ state: "online", processIsNew: true });

    await expect.poll(() => messages().length).toBe(1);
    expect(messages()[0]!.body).toContain("冷启动");
  });

  it("记录说的就是当前这份进程（runId 相同）→ 不拿它当「上一次结束」", async () => {
    stubExitEndpoint({ record: { ...EXIT_RECORD, runId: "run-new" } });
    const { rerender } = mount({ state: "starting", processIsNew: false });
    rerender({ state: "online", processIsNew: true });

    await expect.poll(() => messages().length).toBe(1);
    expect(messages()[0]!.body).not.toContain("自身退出");
  });

  /* 「读不到记录」这件事本身**不蕴含**任何成因：可能是纯手工 pnpm dev 起的服务，
   * 也可能是编排起来的链路里这一次根本没人记（服务没退出过 / 写侧那一档没走到）。
   * 文案断言其中一种，对另一种就是错的 —— 而现场恰恰是后一种（双击 exe）。 */
  it("恢复时也读不到记录：不把成因说成「手工 pnpm dev」，只说这一次是恢复", async () => {
    stubExitEndpoint({ record: null });
    const base = Date.now();
    vi.useFakeTimers({ toFake: ["Date"] });
    const { rerender } = mount({ state: "online", processIsNew: false });
    vi.setSystemTime(base + 1_000);
    rerender({ state: "offline", processIsNew: false });
    vi.setSystemTime(base + 10_000);
    rerender({ state: "online", processIsNew: false });
    vi.useRealTimers();

    await expect.poll(() => messages().length).toBe(2);
    /* store 最新一条在数组头部（这里断言的是「恢复」那条刚写进去）。 */
    const recovered = messages()[0]!;
    expect(recovered.title).toBe("应用服务已恢复");
    expect(recovered.body).toContain("这次断开没有留下结束记录");
    expect(recovered.body).not.toContain("pnpm dev");
    expect(recovered.body).not.toContain("没有经过启动编排");
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

describe("useAppServiceMessageLog：每条消息盖「启动戳」", () => {
  /* 手验反馈：消息中心里多次启动的记录混成一列平铺，分不清哪几条属于同一次启动
   * —— 而这个面板记的恰恰是故障，分不清批次等于分不清故障次数。分组键是 launcher
   * 单点产出的 runId（判据见 `~/lib/shell/message-run-groups`）。 */

  it("断开与恢复盖的是**各自那次启动**的 runId（断开在旧组、恢复在新组）", async () => {
    stubExitEndpoint({ record: null });
    /* 旧启动里断 → 新启动起来（旧 runId 断，新 runId 恢复）。两条边沿落在不同
     * 时刻：面板的次序由**事件时刻**决定（断开那条要先读原因，push 天然更晚）。 */
    const base = Date.now();
    vi.useFakeTimers({ toFake: ["Date"] });
    const { rerender } = mount({
      state: "online",
      processIsNew: false,
      currentRunId: "old0001",
    });
    vi.setSystemTime(base + 1_000);
    rerender({
      state: "offline",
      processIsNew: false,
      currentRunId: "old0001",
    });
    vi.setSystemTime(base + 10_000);
    rerender({ state: "online", processIsNew: true, currentRunId: "new0002" });
    vi.useRealTimers();

    await expect.poll(() => messages().length).toBe(2);
    expect(messages()[0]!.runId, "恢复属于新一次启动").toBe("new0002");
    expect(messages()[1]!.runId, "断开属于正在死的那一次").toBe("old0001");
  });

  it("把「当前是哪一次启动」同步进 store：别的生产方据此盖戳（不必各接一次探活）", async () => {
    stubExitEndpoint();
    const { rerender } = mount({ currentRunId: "a1b2c3" });
    expect(useMessageCenterStore.getState().currentRunId).toBe("a1b2c3");

    rerender({ currentRunId: "d4e5f6" });
    expect(useMessageCenterStore.getState().currentRunId).toBe("d4e5f6");

    /* 推一条**不带 runId** 的（代码更新 / 版本更新就是这种），它应盖上当前这一次。 */
    useMessageCenterStore
      .getState()
      .push({ kind: "info", title: "某次更新", body: "正文" });
    expect(messages()[0]!.runId).toBe("d4e5f6");
  });

  it("拿不到 runId 时留 null（落「未标记启动」那一组，不编一个值）", async () => {
    stubExitEndpoint();
    const { rerender } = mount({ currentRunId: null });
    rerender({ state: "online", processIsNew: true, currentRunId: null });

    await expect.poll(() => messages().length).toBe(1);
    expect(messages()[0]!.runId).toBeNull();
  });
});
