// @vitest-environment jsdom
// 「应用服务为什么断了」在 controller 层的取数契约（ISSUE #1692）。
//
// 这一层要锁住三件事，都是「读一次就够、读错就白读」的：
//   ① 记录只在服务**成功应答之后**才去读（探活走的是刚死那个服务自己的 HTTP）；
//   ② 每个 bootId 只读一次 —— 轮询 2s 一拍，不设这道闸等于每拍都打一次端点；
//   ③ 只认「说的是上一次运行」的记录（runId 与当前进程相同的不显示）。
//
// 判据本身（成因文案、runId 对比）在 `~/lib/shell/app-service-exit` 的单测里，
// 这里只验取数时机与去重。

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";

import {
  OFFLINE_CONFIRM_FAILURES,
  useDevServerLiveness,
} from "./use-dev-server-liveness";

const EXIT_RECORD = {
  at: "2026-10-10T10:00:00.000Z",
  kind: "dev-server",
  code: 137,
  signal: null,
  reason: "Next.js dev server 提前退出（exit=137）",
  port: 3100,
  runId: "run-old",
};

/** 取请求 URL（输入可能是字符串 / URL / Request 三种形态）。 */
function urlOf(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  return input instanceof URL ? input.href : input.url;
}

/** 造一条 fetch 实现：按 URL 分派，并记录每个端点被打了几次。 */
function stubFetch({
  bootId = "dev-boot:new",
  runId = "a1b2c3",
  currentRunId = "run-new",
  record = EXIT_RECORD,
}: {
  bootId?: string;
  runId?: string | null;
  currentRunId?: string | null;
  record?: unknown;
} = {}) {
  const calls = { serverId: 0, lastExit: 0 };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      if (url.includes("/api/dev/server-id")) {
        calls.serverId += 1;
        return new Response(JSON.stringify({ bootId, runId }), { status: 200 });
      }
      if (url.includes("/api/dev/last-exit")) {
        calls.lastExit += 1;
        return new Response(JSON.stringify({ record, currentRunId }), {
          status: 200,
        });
      }
      return new Response("{}", { status: 404 });
    }),
  );
  return calls;
}

beforeEach(() => {
  window.sessionStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("useDevServerLiveness：上一次结束的原因", () => {
  it("探通之后才去读记录，并把原因折叠成可渲染的通知", async () => {
    const calls = stubFetch();
    const { result } = renderHook(() => useDevServerLiveness());

    await expect.poll(() => result.current.everOnline).toBe(true);
    await expect.poll(() => result.current.lastExit).not.toBeNull();

    // 读的是「上一次」那份（runId 与当前不同）。
    expect(calls.lastExit).toBeGreaterThan(0);
    expect(result.current.lastExit?.why).toContain("自身退出");
    // 技术摘要与动作都带上了：只说「为什么」不够，用户还要知道做什么。
    expect(result.current.lastExit?.detail).toContain("137");
    expect(result.current.lastExit?.action.length).toBeGreaterThan(0);
    expect(result.current.lastExitAt).toBe(Date.parse(EXIT_RECORD.at));
  });

  it("同一个 bootId 只读一次（轮询 2s 一拍，没有这道闸就是每拍都打一次端点）", async () => {
    /* 真推进轮询：`useInterval` 是 2s 一拍的真实定时器，不推进就只测到「首探读了
     * 一次」——那道去重闸根本不会被碰到（本用例第一版就是这样，恒绿但测不到东西，
     * 把 `if` 改成 `if (true)` 也不红）。这里用假定时器把时间推过好几拍。 */
    vi.useFakeTimers();
    try {
      const calls = stubFetch();
      renderHook(() => useDevServerLiveness());
      /* 首探（immediate） + 若干拍：每拍都要 flush 微任务让 fetch 的 promise 落定。 */
      await vi.advanceTimersByTimeAsync(2_000 * 4 + 100);

      // 探活跑了很多拍（证明「多拍」这件事真的发生了）。
      expect(calls.serverId).toBeGreaterThan(1);
      // 而记录只读了一次。
      expect(calls.lastExit).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("记录说的就是当前这份进程（runId 相同）→ 不显示（描写的不是过去那一次）", async () => {
    const calls = stubFetch({
      record: { ...EXIT_RECORD, runId: "run-new" },
      currentRunId: "run-new",
    });
    const { result } = renderHook(() => useDevServerLiveness());
    await expect.poll(() => result.current.everOnline).toBe(true);
    /* 等「取过那一轮」这个**事实**成立，而不是等一段时间：读取没发生就不该断言
     * 结果（§11.14 —— 赌时间会在条件早已成立时空等、条件永不成立时只留一句超时）。 */
    await expect.poll(() => calls.lastExit).toBe(1);
    expect(result.current.lastExit).toBeNull();
  });

  it("端点没有记录（record: null）→ lastExit 保持 null，不编一个原因", async () => {
    const calls = stubFetch({ record: null });
    const { result } = renderHook(() => useDevServerLiveness());
    await expect.poll(() => result.current.everOnline).toBe(true);
    await expect.poll(() => calls.lastExit).toBe(1);
    expect(result.current.lastExit).toBeNull();
  });

  it("记录坏掉（半个对象）→ 同样按「没有原因可讲」处理，不炸", async () => {
    const calls = stubFetch({ record: { at: "t" } });
    const { result } = renderHook(() => useDevServerLiveness());
    await expect.poll(() => result.current.everOnline).toBe(true);
    await expect.poll(() => calls.lastExit).toBe(1);
    expect(result.current.lastExit).toBeNull();
  });

  it("端点挂了不影响探活本身（探测那一格仍照常工作）", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        if (urlOf(input).includes("/api/dev/server-id")) {
          return new Response(JSON.stringify({ bootId: "b1" }), {
            status: 200,
          });
        }
        throw new Error("boom");
      }),
    );
    const { result } = renderHook(() => useDevServerLiveness());
    await expect.poll(() => result.current.probeOk).toBe(true);
    expect(result.current.lastExit).toBeNull();
  });
});

describe("useDevServerLiveness：当前是哪一次启动（runId）", () => {
  /* 消息中心按 runId 把历史消息分成「每一次启动」一组（手验反馈：多次启动的
   * 记录混在了一起）。runId 与 bootId 在**同一次探测**里回来，理由是两条都只在
   * 服务应答时才拿得到——拆成两次请求就会在「刚恢复」那一刻还拿着旧值。 */

  it("探测成功即带上 runId（与 bootId 同批落，恢复边沿那刻拿到的已是新一次）", async () => {
    stubFetch({ runId: "a1b2c3" });
    const { result } = renderHook(() => useDevServerLiveness());

    await expect.poll(() => result.current.currentRunId).toBe("a1b2c3");
    /* 与连通性同一拍：不会出现「状态已 online、runId 还是 null」的中间态。 */
    expect(result.current.probeOk).toBe(true);
  });

  it("服务不在时**留住**上一次的 runId（断开那条要盖「正在死的这次启动」的戳）", async () => {
    let serverOk = true;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        if (urlOf(input).includes("/api/dev/server-id")) {
          if (!serverOk) throw new Error("probe timeout");
          return new Response(
            JSON.stringify({ bootId: "b1", runId: "a1b2c3" }),
            { status: 200 },
          );
        }
        return new Response(
          JSON.stringify({ record: null, currentRunId: "a1b2c3" }),
          { status: 200 },
        );
      }),
    );
    const { result } = renderHook(() => useDevServerLiveness());
    await expect.poll(() => result.current.currentRunId).toBe("a1b2c3");

    serverOk = false;
    await expect.poll(() => result.current.probeOk).toBe(false);
    /* 清成 null 就等于「这次断开不知道属于哪一次启动」——消息会掉进
     * 「未标记启动」那一组，而它明明属于正在死的那一次。 */
    expect(result.current.currentRunId).toBe("a1b2c3");
  });

  it("端点没带 runId（纯手工 pnpm dev，没走 launcher）→ null，不编一个值", async () => {
    stubFetch({ runId: null });
    const { result } = renderHook(() => useDevServerLiveness());

    await expect.poll(() => result.current.probeOk).toBe(true);
    expect(result.current.currentRunId).toBeNull();
  });
});

describe("useDevServerLiveness：单拍抖动不算断开", () => {
  /* 手验现场：应用刚起、Turbopack 在按需编译某条路由，探活那一拍超过 2.5s
   * 超时。旧判据把「这一拍没应答」直接当成断开，于是界面在服务好好的情况
   * 下翻成「应用服务已断开」，消息中心写下「断开 + 已恢复」两条，而那两秒里
   * 服务一直在应答（截图里就是断开 15:00:28 / 恢复 15:00:31）。 */
  it("失败一拍仍可达，连续失败到门槛才算断开，重新探通即归零", async () => {
    let serverOk = true;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        if (urlOf(input).includes("/api/dev/server-id")) {
          if (!serverOk) throw new Error("probe timeout");
          return new Response(JSON.stringify({ bootId: "b1" }), {
            status: 200,
          });
        }
        return new Response(
          JSON.stringify({ record: null, currentRunId: "run-new" }),
          { status: 200 },
        );
      }),
    );
    vi.useFakeTimers();
    try {
      const { result } = renderHook(() => useDevServerLiveness());
      /* act 包住推进：探测的 promise 链落在定时器推进之外，不包住的话
       * setState 不会在这一步落定（断言读到的是首帧的 false）。 */
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2_100);
      });
      expect(result.current.everOnline).toBe(true);
      expect(result.current.probeOk).toBe(true);

      serverOk = false;
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2_100);
      });
      expect(result.current.probeOk).toBe(false);
      expect(result.current.consecutiveFailures).toBe(1);
      expect(result.current.reachable).toBe(true);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(2_100);
      });
      expect(result.current.consecutiveFailures).toBe(OFFLINE_CONFIRM_FAILURES);
      expect(result.current.reachable).toBe(false);

      serverOk = true;
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2_100);
      });
      expect(result.current.reachable).toBe(true);
      expect(result.current.consecutiveFailures).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
