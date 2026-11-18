import { describe, expect, it, vi } from "vitest";

import {
  createServerTimingWatcher,
  makeFileTailReader,
  scanServerMarkers,
} from "../scripts/launcher-core/server-timings.mjs";

describe("scanServerMarkers（dev server stdout 的服务端耗时标记）", () => {
  it("提取 Next 就绪耗时（ms 形态）", () => {
    expect(scanServerMarkers("✓ Ready in 663ms")).toEqual({ readyMs: 663, firstPageMs: null });
  });

  it("秒形态与毫秒形态都收（Next 对快慢请求两种打印）", () => {
    expect(scanServerMarkers("✓ Ready in 12.5s").readyMs).toBe(12_500);
    expect(scanServerMarkers("GET /workspace 200 in 16.7s").firstPageMs).toBe(16_700);
    expect(scanServerMarkers("GET /workspace 200 in 850ms").firstPageMs).toBe(850);
  });

  it("没有标记 / 只有一类时缺的那类为 null", () => {
    expect(scanServerMarkers("")).toEqual({ readyMs: null, firstPageMs: null });
    expect(scanServerMarkers("GET /api/health 200 in 12ms")).toEqual({
      readyMs: null,
      firstPageMs: null,
    });
  });
});

/** 监视器的测试台：时钟、文件内容、时间线全部注入，逐轮驱动 tick。 */
function makeHarness(options: { chunks: Array<string>; now: number; startedAt: number }) {
  const add = vi.fn();
  const refreshStatus = vi.fn();
  const timeline = { add };
  let round = 0;
  const watcher = createServerTimingWatcher({
    timeline,
    refreshStatus,
    readNew: (fromOffset: number) => {
      const text = options.chunks.slice(round, round + 1).join("");
      round += 1;
      return { text, endOffset: fromOffset + text.length };
    },
    now: () => options.now,
    startedAt: options.startedAt,
  });
  return { add, refreshStatus, watcher, timeline };
}

describe("createServerTimingWatcher（增量扫描 → 反推服务端耗时）", () => {
  it("首轮扫到 Ready 标记：按标记自述的耗时反推「服务进程启动」段并刷新状态", () => {
    const now = 1_000_000;
    const startedAt = 900_000;
    const { add, refreshStatus, watcher } = makeHarness({
      now,
      startedAt,
      chunks: ["✓ Ready in 663ms"],
    });
    watcher.tick();
    expect(add).toHaveBeenCalledWith(
      "next-boot",
      "服务进程启动",
      now - startedAt - 663,
      now - startedAt,
    );
    expect(refreshStatus).toHaveBeenCalledTimes(1);
  });

  it("第二轮扫到 /workspace 200：补「首页编译」段；两段齐了就不再扫", () => {
    const now = 1_000_000;
    const startedAt = 900_000;
    const { add, refreshStatus, watcher } = makeHarness({
      now,
      startedAt,
      chunks: ["✓ Ready in 663ms", "GET /workspace 200 in 12.5s", "GET /workspace 200 in 12.5s"],
    });
    watcher.tick();
    watcher.tick();
    expect(add).toHaveBeenCalledTimes(2);
    expect(add).toHaveBeenLastCalledWith(
      "first-page",
      "首页编译",
      now - startedAt - 12_500,
      now - startedAt,
    );
    const callsAfterBoth = add.mock.calls.length;
    watcher.tick();
    expect(add.mock.calls.length).toBe(callsAfterBoth);
    expect(refreshStatus).toHaveBeenCalledTimes(2);
  });

  it("dev 已退出 / 预算用尽：不再扫描", () => {
    const now = 1_000_000;
    const startedAt = 900_000;
    const exited = makeHarness({ now, startedAt, chunks: ["✓ Ready in 663ms"] });
    const exitedWatcher = createServerTimingWatcher({
      timeline: exited.timeline,
      refreshStatus: exited.refreshStatus,
      readNew: () => ({ text: "✓ Ready in 663ms", endOffset: 20 }),
      now: () => now,
      startedAt,
      devExited: () => true,
    });
    exitedWatcher.tick();
    expect(exited.add).not.toHaveBeenCalled();

    const budget = makeHarness({ now, startedAt, chunks: ["✓ Ready in 663ms"] });
    const budgetWatcher = createServerTimingWatcher({
      timeline: budget.timeline,
      refreshStatus: budget.refreshStatus,
      readNew: () => ({ text: "✓ Ready in 663ms", endOffset: 20 }),
      now: () => now,
      startedAt: startedAt - 400_000,
      budgetMs: 300_000,
    });
    budgetWatcher.tick();
    expect(budget.add).not.toHaveBeenCalled();
  });

  it("makeFileTailReader：从指定偏移读新增尾部，文件缺失时返回空", () => {
    const reader = makeFileTailReader(`${process.cwd()}/.tmp/server-timings-fixture.txt`);
    expect(reader(0).text).toBe("");
    expect(reader(0).endOffset).toBe(0);
  });
});
