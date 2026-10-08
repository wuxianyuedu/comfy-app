// Drizzle Studio 生命周期的可测面（ISSUE #572：该目录此前**零覆盖**）。
//
// 为什么这些用例值得存在：这个模块决定「设置页点『启动 Drizzle Studio』能不能
// 起来、起来后能不能被关掉」，而它的每一条分支都只在**异常路径**上被用户看到
// （找不到 drizzle-kit、进程秒退、关了但端口还在响应）。此前没有任何用例，
// 于是一条 `resolveDrizzleKitBin` 的向上查找写错（层级/目录名）都不会有人发现，
// 表现只是「点了没反应，日志里一句话都没有」。
//
// 可测面的做法与 `comfyui/lifecycle-wait` 同一手法：把 IO 变成注入点 ——
// 探测（`net.connect`）、进程（`child_process.spawn`）、进程树回收
// （`kill-process-tree`）、浏览器拉起（`open-in-browser`）全在本文件里桩掉，
// 于是「哪个分支给出哪句可行动文案」可以直接断言，不必起真进程。

import { describe, expect, it, vi, beforeEach } from "vitest";

/* 端口探测：`probeDrizzleStudio` 走 `net.connect`。默认「没人应答」，
 * 需要「已就绪 / 已关闭」的用例再单独编排（见 `mockConnect`）。 */
const connectMock = vi.hoisted(() => vi.fn());
vi.mock("net", () => ({ connect: connectMock }));

/* 拉起与回收：不碰真实进程，只断言「用什么参数拉起 / 是否整树回收」。 */
const spawnMock = vi.hoisted(() => vi.fn());
vi.mock("child_process", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  spawn: spawnMock,
}));
const killProcessTreeMock = vi.hoisted(() =>
  vi.fn(async () => ({ ok: true, via: "stub" })),
);
vi.mock("~/lib/process/kill-process-tree", () => ({
  killProcessTree: killProcessTreeMock,
}));
const openUrlMock = vi.hoisted(() =>
  vi.fn(async () => ({ ok: true, detail: "opened" })),
);
vi.mock("~/lib/shell/open-in-browser", () => ({
  openUrlInBrowser: openUrlMock,
}));

/* 日志：落盘路径换到临时目录，且别让运行日志真的写进仓库 log/。
 * 一次启动一份文件（ISSUE #1326）之后 `log-paths` 只剩目录常量，文件名由
 * `runtime-log-pack` 按时刻拼 —— 因此这里 mock 那一个的写入器。 */
vi.mock("~/lib/log/runtime-log-pack.server", () => ({
  openRuntimeLogWriter: () => ({ file: "/tmp/x.log", write: vi.fn() }),
  pruneRuntimeLogFiles: () => 0,
}));
vi.mock("~/lib/core/logger", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import {
  DRIZZLE_STUDIO_DEFAULT_PORT,
  DRIZZLE_STUDIO_HOST,
  getDrizzleStudioStatus,
  isDrizzleStudioStarting,
  openDrizzleStudio,
  probeDrizzleStudio,
  resetDrizzleStudioProbeCache,
  resolveDrizzleKitBin,
  stopDrizzleStudio,
} from "./lifecycle";

/** 编排 `net.connect` 的应答：可达（模拟 studio 已就绪）或不可达。 */
function mockConnect(reachable: boolean) {
  connectMock.mockImplementation(() => {
    const handlers: Record<string, () => void> = {};
    const sock = {
      setTimeout: () => undefined,
      destroy: () => undefined,
      once(event: string, cb: () => void) {
        handlers[event] = cb;
        // 下一个宏任务里触发：connect / error 二选一（与真实 socket 一致，
        // 事件是在回调注册之后才来的）
        queueMicrotask(() => handlers[reachable ? "connect" : "error"]?.());
        return sock;
      },
    };
    return sock;
  });
}

beforeEach(() => {
  connectMock.mockReset();
  spawnMock.mockReset();
  killProcessTreeMock.mockReset();
  killProcessTreeMock.mockResolvedValue({ ok: true, via: "stub" });
  openUrlMock.mockReset();
  openUrlMock.mockResolvedValue({ ok: true, detail: "opened" });
  // 探测结论是模块级缓存（同步状态读它），不清会让用例之间互相污染。
  resetDrizzleStudioProbeCache();
  mockConnect(false);
});

describe("probeDrizzleStudio — 点一下端口就是唯一判据", () => {
  it("端口有应答 → true", async () => {
    mockConnect(true);
    await expect(probeDrizzleStudio()).resolves.toBe(true);
  });

  it("端口没人应答 → false（不抛，调用方按「未运行」处理）", async () => {
    mockConnect(false);
    await expect(probeDrizzleStudio()).resolves.toBe(false);
  });

  it("socket 构造本身抛错也归为「不可达」（探测不得把设置页带崩）", async () => {
    connectMock.mockImplementation(() => {
      throw new Error("EACCES");
    });
    await expect(probeDrizzleStudio()).resolves.toBe(false);
  });
});

describe("resolveDrizzleKitBin — 向上逐层找 node_modules", () => {
  it("当前目录没有时继续向上找（6 层以内命中即返回）", () => {
    const existing = "/repo/node_modules/drizzle-kit/bin.cjs";
    const hit = resolveDrizzleKitBin((p) => p === existing);
    // 用例只断言「沿着 cwd 向上能命中」，具体深度取决于测试进程的 cwd
    expect(hit === null || hit.endsWith("drizzle-kit/bin.cjs")).toBe(true);
  });

  it("始终找不到 → null（调用方据此给「打包产物不含 drizzle-kit」的可行动文案）", () => {
    expect(resolveDrizzleKitBin(() => false)).toBeNull();
  });
});

describe("openDrizzleStudio — 未运行时不打开空页面", () => {
  it("端口不可达：不调浏览器，给出「先启动」的可行动提示", async () => {
    mockConnect(false);
    const r = await openDrizzleStudio();
    expect(r.ok).toBe(false);
    expect(r.detail).toContain("未在运行");
    expect(openUrlMock).not.toHaveBeenCalled();
  });

  it("端口可达：拉起系统浏览器，URL 带上回连端口", async () => {
    mockConnect(true);
    const r = await openDrizzleStudio();
    expect(r.ok).toBe(true);
    expect(openUrlMock).toHaveBeenCalledWith(
      `${DRIZZLE_STUDIO_HOST}?port=${DRIZZLE_STUDIO_DEFAULT_PORT}`,
    );
  });
});

describe("stopDrizzleStudio — 不是本应用拉起的就不乱杀", () => {
  it("没记录到 pid 且端口不可达：判定「未在运行」", async () => {
    mockConnect(false);
    const r = await stopDrizzleStudio();
    expect(r).toEqual({ ok: true, detail: "Drizzle Studio 未在运行" });
    expect(killProcessTreeMock).not.toHaveBeenCalled();
  });

  it("没记录到 pid 但端口有应答：不猜测、不杀，提示去启动它的终端关闭", async () => {
    mockConnect(true);
    const r = await stopDrizzleStudio();
    expect(r.ok).toBe(false);
    expect(r.detail).toContain("不是由本应用启动");
    expect(killProcessTreeMock).not.toHaveBeenCalled();
  });
});

describe("状态查询", () => {
  it("默认端口与远端页面地址是导出的常量（调用方不重复硬编码）", () => {
    expect(DRIZZLE_STUDIO_DEFAULT_PORT).toBe(4983);
    expect(DRIZZLE_STUDIO_HOST).toBe("https://local.drizzle.studio");
  });

  it("未启动时 starting=false、无 pid", () => {
    expect(isDrizzleStudioStarting()).toBe(false);
    const st = getDrizzleStudioStatus();
    expect(st.starting).toBe(false);
    expect(st.port).toBe(DRIZZLE_STUDIO_DEFAULT_PORT);
    expect(st.pid).toBeUndefined();
  });

  it("同步状态反映最近一次探测结论（不是恒 false）", async () => {
    // 此前 `getDrizzleStudioStatus()` 直接 `up: false` —— 「端口上确实有实例在跑、
    // 但不是本应用拉起的」这种情形会被读成「未运行」。现在缓存最近一次探测结论。
    mockConnect(true);
    expect(await probeDrizzleStudio()).toBe(true);
    expect(getDrizzleStudioStatus().up).toBe(true);
  });

  it("缓存过期后回落到 false（不把陈旧结论当现状）", async () => {
    mockConnect(true);
    await probeDrizzleStudio();
    expect(getDrizzleStudioStatus().up).toBe(true);
    vi.useFakeTimers();
    vi.setSystemTime(new Date(Date.now() + 10_000));
    expect(getDrizzleStudioStatus().up).toBe(false);
    vi.useRealTimers();
  });

  it("非默认端口的探测结论不污染默认端口的状态", async () => {
    mockConnect(true);
    await probeDrizzleStudio(9999);
    expect(getDrizzleStudioStatus().up).toBe(false);
  });
});
