/**
 * 保活「接管」场景补挂退出监督（ensureKeepAliveWatchOnAdoption）。
 *
 * 要钉住的是：应用重启后复用了上一次会话拉起的保活实例时，那个实例不是本进程
 * 拉起的，`launchKeepAliveMode` 不会给它装监督器 —— 不补上，它之后真没了就
 * 只剩状态轮询里的「未运行」，原因一个字都没有（「保活莫名退出」的来源）。
 *
 * 同时必须**幂等**：状态轮询 / WS 重连会反复走到这里，重挂会把「进程开头
 * 时间」重置成最后一次轮询的时刻，存活时长就失真了。
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../app-settings/app-settings.server", () => ({
  getExitPolicy: vi.fn(),
  getSettingsSync: vi.fn().mockReturnValue({ comfyuiPath: "/x" }),
}));
vi.mock("./launch-path", () => ({
  resolveComfyLaunchPlan: vi.fn().mockReturnValue({
    cmd: "python",
    baseArgs: ["-s", "/x/main.py"],
    cwd: "/x",
    mainPy: "/x/main.py",
  }),
}));
vi.mock("./proc-detect", () => ({
  findPidForMainPyDetailed: vi
    .fn()
    .mockResolvedValue({ pid: null, failed: false }),
  findPidListeningPort: vi.fn().mockResolvedValue(null),
}));
vi.mock("~/lib/process/process-launch", () => ({
  spawnManaged: vi.fn(),
  waitForDetachMediator: vi.fn().mockResolvedValue({ code: 0, stderr: "" }),
}));
/* 日志目录隔离到临时目录（保活重定向文件按次落在这里）。 */
vi.mock("~/lib/log/log-paths", () => {
  const dir = `${process.env.TEMP ?? process.env.TMPDIR ?? "/tmp"}/comfyapp-lifecycle-launch-test`;
  return { SERVICES_LOG_DIR: dir };
});
/* 监督器本身的判死逻辑由 lifecycle-exit.test.ts 覆盖；这里只关心「有没有挂、
 * 挂了什么」，故把 startComfyExitWatcher 换成桩（也免得真起定时器），其余
 * 导出保持原实现（onExit 要走真实的 reportKeepAliveExit）。 */
vi.mock("./lifecycle-exit", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, startComfyExitWatcher: vi.fn(() => ({ stop: vi.fn() })) };
});

import {
  getExitPolicy,
  getSettingsSync,
} from "../app-settings/app-settings.server";

import { startComfyExitWatcher } from "./lifecycle-exit";
import {
  ensureKeepAliveWatchOnAdoption,
  type LaunchHost,
} from "./lifecycle-launch";

function fakeHost(): LaunchHost {
  return {
    st: { stopRequested: false },
    appendRuntimeLog: vi.fn(),
    appendSessionBanner: vi.fn(),
    clearComfyStopping: vi.fn(),
    localTimestamp: () => "stamp",
    markSessionStart: vi.fn(),
    markSessionEnd: vi.fn(),
    probeComfyUi: vi.fn().mockResolvedValue("http://127.0.0.1:8188"),
  };
}

function arm(h: LaunchHost): void {
  ensureKeepAliveWatchOnAdoption({
    host: h,
    settings: getSettingsSync(),
    note: vi.fn(),
  });
}

describe("ensureKeepAliveWatchOnAdoption —— 接管场景补挂保活退出监督", () => {
  beforeEach(() => {
    /* 模块里的「已挂监督器」是模块级状态、跨用例累积：不复位的话第 2 个用例
     * 读到的就是第 1 个用例挂上的那个，「挂上 / 幂等」两类断言都会失真。
     * 任何一次 onExit 都会把引用清成 null，借它复位到「没挂」的起点。 */
    const calls = vi.mocked(startComfyExitWatcher).mock.calls;
    const lastDeps =
      calls.length > 0 ? calls[calls.length - 1]?.[0] : undefined;
    lastDeps?.onExit({ pid: 1, uptimeMs: 0 });
    vi.mocked(startComfyExitWatcher).mockClear();
  });

  it("bound 策略（关闭应用时连带关闭）→ 不挂：退出由直连的 exit 事件落", () => {
    vi.mocked(getExitPolicy).mockReturnValue({
      exitKillComfyui: true,
      exitKillOllama: true,
    });
    arm(fakeHost());
    expect(startComfyExitWatcher).not.toHaveBeenCalled();
  });

  it("保活策略且还没挂 → 挂上监督器", () => {
    vi.mocked(getExitPolicy).mockReturnValue({
      exitKillComfyui: false,
      exitKillOllama: false,
    });
    arm(fakeHost());
    expect(startComfyExitWatcher).toHaveBeenCalledTimes(1);
    const deps = vi.mocked(startComfyExitWatcher).mock.calls[0]?.[0];
    expect(typeof deps?.findPid).toBe("function");
  });

  it("已经被挂上 → 再调用不重挂（状态轮询反复触发也不重置进程开头时间）", () => {
    vi.mocked(getExitPolicy).mockReturnValue({
      exitKillComfyui: false,
      exitKillOllama: false,
    });
    const h = fakeHost();
    arm(h);
    arm(h);
    arm(h);
    expect(startComfyExitWatcher).toHaveBeenCalledTimes(1);
  });

  it("监督器报过退出之后 → 引用清空，下次接管可以重新挂上", () => {
    vi.mocked(getExitPolicy).mockReturnValue({
      exitKillComfyui: false,
      exitKillOllama: false,
    });
    const h = fakeHost();
    arm(h);
    const deps = vi.mocked(startComfyExitWatcher).mock.calls[0]?.[0];
    expect(deps).toBeDefined();
    // 模拟「保活进程消失了」：监督器自停并清掉引用
    deps?.onExit({ pid: 4242, uptimeMs: 1000 });
    expect(h.markSessionEnd).toHaveBeenCalled();

    arm(fakeHost());
    expect(startComfyExitWatcher).toHaveBeenCalledTimes(2);
  });
});
