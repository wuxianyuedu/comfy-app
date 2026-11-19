// compose-film 的 ffmpeg 助手判决面（#4226/#4228）：
//   · 探测缓存口径——正结果长期有效、负结果带 TTL（装好 ffmpeg 不再需要重启）；
//   · stderr 尾部收集器——上限截断保留**尾部**（ffmpeg 的结论在最后几行），
//     分片淘汰摊销近似 O(n)，超限不丢最新的结论行。
// 被测的两条只依赖 spawn（桩掉，不起真 ffmpeg）；模块其余依赖照 orchestrator.test.ts
// 的 mock 边界桩掉（本文件不触真库）。

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

vi.mock("~/lib/core/repository", () => ({
  filmRepository: {},
  filmShotRepository: {},
}));
vi.mock("~/lib/core/repository-production", () => ({
  productionRepository: {},
}));
vi.mock("~/lib/db", () => ({
  db: { transaction: async <T>(fn: (tx: unknown) => Promise<T>) => fn({}) },
}));

/* spawn 桩：每次调用给一个「error 事件异步触发」的假进程（探测 → code -2 → 负结果）。 */
const spawnMock = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", () => ({
  spawn: spawnMock,
}));

import { createStderrTailSink, isFFmpegAvailable, resetFFmpegProbeForTest } from "./compose-film";

/** 一个 error 事件异步触发的假进程（runFFmpeg 的 error 分支 → code -2）。 */
function failingChild(): { on: (event: string, cb: (arg?: unknown) => void) => void } {
  const handlers = new Map<string, (arg?: unknown) => void>();
  queueMicrotask(() => {
    handlers.get("error")?.(new Error("spawn ENOENT"));
  });
  return {
    on: (event, cb) => {
      handlers.set(event, cb);
    },
  };
}

beforeEach(() => {
  resetFFmpegProbeForTest();
  spawnMock.mockClear();
  spawnMock.mockImplementation(() => failingChild());
});

afterEach(() => {
  vi.useRealTimers();
});

describe("isFFmpegAvailable 的探测缓存（#4226）", () => {
  it("负结果在 TTL 窗口内复用（不重复 spawn）；窗口过期后重探", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));

    expect(await isFFmpegAvailable()).toBe(false);
    expect(await isFFmpegAvailable()).toBe(false);
    expect(spawnMock).toHaveBeenCalledTimes(1); // TTL 内复用缓存

    vi.setSystemTime(new Date("2026-01-01T00:00:31Z")); // 过 30s TTL
    expect(await isFFmpegAvailable()).toBe(false);
    expect(spawnMock).toHaveBeenCalledTimes(2); // 过期重探
  });

  it("正结果长期有效：过了 TTL 也不重探（装了不会自己消失）", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    /* 这次探测成功：spawn 的假进程 close(0)。 */
    spawnMock.mockImplementation(() => {
      const handlers = new Map<string, (arg?: unknown) => void>();
      queueMicrotask(() => {
        handlers.get("close")?.(0);
      });
      return {
        stderr: { on: vi.fn() },
        on: (event: string, cb: (arg?: unknown) => void) => {
          handlers.set(event, cb);
        },
      };
    });

    expect(await isFFmpegAvailable()).toBe(true);
    vi.setSystemTime(new Date("2026-01-01T01:00:00Z")); // 过 1 小时
    expect(await isFFmpegAvailable()).toBe(true);
    expect(spawnMock).toHaveBeenCalledTimes(1); // 正结果永久缓存
  });
});

describe("createStderrTailSink 的尾部截断（#4228）", () => {
  it("超限后保留尾部：最新的结论行在，最早的 progress 刷屏被淘汰", () => {
    const sink = createStderrTailSink(100);
    for (let i = 0; i < 30; i++) {
      sink.sink(Buffer.from(`progress line ${i} ${"x".repeat(10)}\n`));
    }
    sink.sink(Buffer.from("frame= 9999 final verdict\n"));
    const text = sink.text();
    expect(text).toContain("final verdict");
    expect(text).not.toContain("progress line 0 ");
    expect(text.length).toBeLessThanOrEqual(100 + 64); // 上限 + 单 chunk 余量
  });

  it("不超限时一字不丢", () => {
    const sink = createStderrTailSink(10_000);
    sink.sink(Buffer.from("keep me\n"));
    expect(sink.text()).toBe("keep me\n");
  });
});
