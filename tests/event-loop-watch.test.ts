// 事件循环阻塞观测（ISSUE #3369）的判据：漂移怎么算、什么算一次阻塞、
// 阻塞之后基准必须推进（否则同一次阻塞记成两条）、窗口裁剪与只读副本。
// 定时器侧只测「启动幂等 + 挂上定时器」，不测真实时钟。

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  EVENT_LOOP_BLOCKS_MAX,
  eventLoopBeat,
  eventLoopWatchRunning,
  latestEventLoopBlocks,
  resetEventLoopWatchForTests,
  startEventLoopWatch,
} from "~/lib/log/event-loop-watch.server";

describe("eventLoopBeat 心跳漂移判据", () => {
  beforeEach(() => {
    resetEventLoopWatchForTests();
  });

  afterEach(() => {
    resetEventLoopWatchForTests();
  });

  it("按时连拍（间隔恰好一拍）不记录", () => {
    expect(eventLoopBeat(1000)).toBeNull();
    expect(eventLoopBeat(2000)).toBeNull();
    expect(eventLoopBeat(3000)).toBeNull();
    expect(latestEventLoopBlocks()).toEqual([]);
  });

  it("漂移达到阈值（≥3s）记一条：起点 = 上一拍 + 一拍，终点 = 本拍", () => {
    eventLoopBeat(1000);
    // 上一拍 1000，本该 2000 出现，拖到 6000 才来 → 漂移 4000。
    const block = eventLoopBeat(6000);
    expect(block).not.toBeNull();
    expect(block?.driftMs).toBe(4000);
    expect(block?.startedAt).toBe(2000);
    expect(block?.endedAt).toBe(6000);
    expect(latestEventLoopBlocks()).toHaveLength(1);
  });

  it("阻塞恢复后的第一拍只记一次：基准推进，下一拍不再重复", () => {
    eventLoopBeat(1000);
    eventLoopBeat(6000); // 一次 4s 阻塞
    // 恢复后的正常一拍：从**这一拍**起算，不带着上一次的漂移。
    expect(eventLoopBeat(7000)).toBeNull();
    expect(latestEventLoopBlocks()).toHaveLength(1);
  });

  it("低于阈值（<3s）的抖动不记录（GC / 调度噪音不值得发日志）", () => {
    eventLoopBeat(1000);
    expect(eventLoopBeat(3999)).toBeNull(); // 漂移 1999ms
    expect(latestEventLoopBlocks()).toEqual([]);
  });

  it("多读数按时间序保留，超上限裁掉最旧的", () => {
    eventLoopBeat(1000);
    for (let i = 0; i < EVENT_LOOP_BLOCKS_MAX + 5; i++) {
      const base = 10_000 + i * 10_000;
      eventLoopBeat(base); // 正常拍
      eventLoopBeat(base + 4000); // 漂移 3s 的一拍
    }
    const all = latestEventLoopBlocks();
    expect(all).toHaveLength(EVENT_LOOP_BLOCKS_MAX);
    // 最旧的一批被裁掉：剩下的是最后 EVENT_LOOP_BLOCKS_MAX 条，时间序不乱。
    expect(all[0]?.endedAt).toBeLessThan(all.at(-1)?.endedAt ?? 0);
  });

  it("返回的是副本：改返回值不影响内部状态", () => {
    eventLoopBeat(1000);
    eventLoopBeat(6000);
    const snapshot = latestEventLoopBlocks();
    snapshot.length = 0;
    expect(latestEventLoopBlocks()).toHaveLength(1);
  });
});

describe("startEventLoopWatch 启动侧", () => {
  beforeEach(() => {
    resetEventLoopWatchForTests();
    vi.useFakeTimers();
  });

  afterEach(() => {
    resetEventLoopWatchForTests();
    vi.useRealTimers();
  });

  it("挂上定时器且幂等：重复启动不叠加心跳", () => {
    startEventLoopWatch();
    expect(eventLoopWatchRunning()).toBe(true);
    startEventLoopWatch();
    // 叠加的心跳会把同一窗口记成多条（漂移判据本身已由上面的直调用例钉住）；
    // fake 定时器永远「按时」触发、模拟不了真实阻塞，所以这里只数定时器。
    expect(vi.getTimerCount()).toBe(1);
  });
});
