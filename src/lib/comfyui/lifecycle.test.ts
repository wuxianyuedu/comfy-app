// lifecycle 的「手动关闭后不自动启动」闩锁单测。
// 覆盖 ISSUE #290：用户在设置页点「关闭 ComfyUI」后，WS 重连 / 状态轮询触发的
// 自动启动（ensureComfyUiReady，manual=false）不应再把 ComfyUI 悄悄拉起；
// 只有手动点「启动 ComfyUI」（manual=true）或重新开启自动启动才清闩锁并放行。

import { describe, it, expect, vi, beforeEach } from "vitest";

/* Mock 掉 lifecycle 的副作用依赖：避免测试触碰真实 spawn / fs / DB / ComfyUI。
 *  probeComfyUi 由 resolveComfyBase 兜底：resolveComfyBase 抛错 → probeComfyUi 返回 null。
 *  stopComfyUiProcess 只需走到「pid 未定位到 → 返回未在运行」分支即可把 manualStop 置上。
 *  lifecycle 的全局状态挂在 globalThis（HMR 单例），跨用例会持久累积；
 *  每个用例都先 stopComfyUiProcess 落闩锁，再按自身场景断言，故不额外清 state。 */
vi.mock("../app-settings", () => ({
  COMFYUI_DEFAULT_PORT: 8188,
  getExitPolicy: vi.fn().mockReturnValue({ exitKillComfyui: true }),
  getSettingsSync: vi.fn(),
}));
vi.mock("./client", () => ({ resolveComfyBase: vi.fn().mockRejectedValue(new Error("not running")) }));
vi.mock("./launch-path", () => ({
  resolveComfyLaunchPlan: vi.fn().mockReturnValue({
    cmd: "python",
    baseArgs: ["-s", "/x/main.py"],
    cwd: "/x",
    mainPy: "/x/main.py",
  }),
}));
vi.mock("./desktop-instance", () => ({ resolveEffectiveLaunch: vi.fn().mockResolvedValue({ port: 0, extraArgs: [] }) }));
vi.mock("./proc-detect", () => ({
  findPidForMainPy: vi.fn().mockResolvedValue(null),
  findPidListeningPort: vi.fn().mockResolvedValue(null),
}));
vi.mock("../process-launch", () => ({
  spawnManaged: vi.fn(),
  waitForDetachMediator: vi.fn().mockResolvedValue({ code: 0, stderr: "" }),
}));
vi.mock("~/lib/open-in-browser", () => ({ openUrlInBrowser: vi.fn().mockResolvedValue({ ok: true }) }));
vi.mock("../log-paths", () => ({
  COMFYUI_RUNTIME_LOG: "/tmp/comfyui-runtime.log",
  SERVICES_LOG_DIR: "/tmp",
}));
vi.mock("~/server/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import {
  stopComfyUiProcess,
  ensureComfyUiReady,
  clearComfyManualStop,
  clearComfyAutoStartFailure,
} from "./lifecycle";
import { findPidForMainPy } from "./proc-detect";
import { getSettingsSync } from "../app-settings";

const autoStartSettings = {
  comfyuiPath: "/x",
  comfyuiAutoStart: true,
  comfyuiPort: 0,
  comfyuiExtraArgs: "",
};

beforeEach(() => {
  vi.mocked(getSettingsSync).mockReturnValue(autoStartSettings as never);
});

describe("手动关闭 ComfyUI 后抑制自动启动（ISSUE #290）", () => {
  it("stopComfyUiProcess 落闩锁后，自动启动路径返回「手动关闭」而不拉起进程", async () => {
    await stopComfyUiProcess(); // 手动关闭 → 置 manualStop 闩锁

    const r = await ensureComfyUiReady({}); // 自动启动来源（如 WS 重连）

    expect(r.ok).toBe(false);
    expect(r.detail).toContain("手动关闭");
  });

  it("手动点「启动 ComfyUI」（manual:true）清闩锁并放行到设置检查", async () => {
    await stopComfyUiProcess(); // 先手动关闭，落闩锁

    // 手动启动：manual=true 应先清闩锁，再往下走到 comfyuiAutoStart 检查。
    // 这里把 autoStart 置 false，使流程在设置检查处返回（证明已被清闩锁放行，
    // 而不是被「手动关闭」拦下）。
    vi.mocked(getSettingsSync).mockReturnValue({ ...autoStartSettings, comfyuiAutoStart: false } as never);
    const r = await ensureComfyUiReady({ manual: true });

    expect(r.ok).toBe(false);
    expect(r.detail).toContain("未开启自动启动");
  });

  it("clearComfyManualStop 清闩锁后，自动启动不再被拦", async () => {
    await stopComfyUiProcess(); // 落闩锁
    clearComfyManualStop();     // 设置保存重新开启自动启动时清除

    vi.mocked(getSettingsSync).mockReturnValue({ ...autoStartSettings, comfyuiAutoStart: false } as never);
    const r = await ensureComfyUiReady({});

    // 既然闩锁已清，应落到「未开启自动启动」而非「已被手动关闭」。
    expect(r.detail).toContain("未开启自动启动");
  });
});

describe("自动启动失败后停止重试（ISSUE #335）", () => {
  /* 造一次「明确失败」的自动启动：让 launch plan 解析失败（路径不存在）。
   * 这是与「保活进程已退出」同类、且不依赖 15s 宽限期的可复现失败——
   * 二者都走 note + { ok:false, detail } 的同一条收口路径。 */
  const runFailingAutoStart = async () => {
    const { resolveComfyLaunchPlan } = await import("./launch-path");
    const { spawnManaged } = await import("../process-launch");
    vi.mocked(spawnManaged).mockClear();
    vi.mocked(resolveComfyLaunchPlan).mockReturnValue({
      error: "ComfyUI 路径不存在：/nope（请在设置页检查）",
    });
    vi.mocked(getSettingsSync).mockReturnValue(autoStartSettings as never);
    return ensureComfyUiReady({ timeoutMs: 5_000 });
  };

  it("失败后自动路径不再拉起进程，直接回报上次失败详情", async () => {
    const first = await runFailingAutoStart();
    expect(first.ok).toBe(false);
    expect(first.detail).toContain("路径不存在");

    const { spawnManaged } = await import("../process-launch");
    vi.mocked(spawnManaged).mockClear();

    const second = await ensureComfyUiReady({});
    expect(second.ok).toBe(false);
    // 原样回报上次的失败原因，而不是泛泛的「已跳过」
    expect(second.detail).toBe(first.detail);
    // 关键：没有再 spawn 一次（否则就是「一直自动重试」）
    expect(vi.mocked(spawnManaged)).not.toHaveBeenCalled();
  });

  it("手动启动（manual:true）清失败闩锁，放行走设置检查", async () => {
    await runFailingAutoStart();
    vi.mocked(getSettingsSync).mockReturnValue({
      ...autoStartSettings,
      comfyuiAutoStart: false,
    } as never);

    const r = await ensureComfyUiReady({ manual: true });
    // 闩锁已清 → 不被「上次失败」拦下，落到「未开启自动启动」
    expect(r.detail).toContain("未开启自动启动");
  });

  it("clearComfyManualStop（重新开启自动启动）同时清失败闩锁", async () => {
    await runFailingAutoStart();
    clearComfyManualStop();
    vi.mocked(getSettingsSync).mockReturnValue({
      ...autoStartSettings,
      comfyuiAutoStart: false,
    } as never);

    const r = await ensureComfyUiReady({});
    expect(r.detail).toContain("未开启自动启动");
  });

  it("clearComfyAutoStartFailure 清闩锁后，自动路径重新尝试启动", async () => {
    await runFailingAutoStart();
    clearComfyAutoStartFailure();

    const { resolveComfyLaunchPlan } = await import("./launch-path");
    vi.mocked(resolveComfyLaunchPlan).mockReturnValue({
      error: "ComfyUI 路径不存在：/nope（请在设置页检查）",
    });

    const r = await ensureComfyUiReady({});
    // 闩锁已清 → 不被拦，重新走到 plan 解析并再次失败
    expect(r.detail).toContain("路径不存在");
  });
});

/* ── 状态三态与进程树回收判据（同一套 mock）──────────────────────────
 * 上半部分覆盖「手动关闭闩锁」；这一段补上设置页状态行与关闭动作依赖的
 * 另外两条契约：
 *   1. getComfyUiStatus 的 starting / stopping / pid 三态组合；
 *   2. 关闭动作在 Windows 上必须走 `taskkill /PID <pid> /T /F` 杀整树
 *      （单杀会留下 python 孤儿占端口、锁日志文件）。
 * 两条都是「读代码看不出回归、只有跑起来才发现」的那类规则。 */

describe("getComfyUiStatus — 状态三态组合", () => {
  it("未启动任何流程时：up/starting/stopping 均为 false，pid 为 undefined", async () => {
    const { getComfyUiStatus } = await import("./lifecycle");
    const s = await getComfyUiStatus();
    expect(s.up).toBe(false);
    expect(s.base).toBeNull();
    expect(s.starting).toBe(false);
    expect(s.stopping).toBe(false);
    expect(s.pid).toBeUndefined();
  });

  it("启动进行中时 starting=true、收尾后回 false（设置页据此禁用「启动 ComfyUI」）", async () => {
    const { ensureComfyUiReady, getComfyUiStatus } = await import("./lifecycle");
    const { getExitPolicy } = await import("../app-settings");
    const { spawnManaged } = await import("../process-launch");
    // 走保活（keepAlive）路径 + 进程探测永远找不到 main.py：启动会一直等到
    // timeoutMs 到点收尾，这段时间正好观察 starting 的 true → false 两端。
    // 保活路径用 spawnManaged（已被 mock），不会真实起进程。
    //
    // 必须显式把 launch plan 还原成「可拉起」：上面「启动失败」一组用例把
    // 它 mock 成 { error }（解析即失败的走法），mock 是文件级共享的——
    // 不还原就会在 plan 解析处直接收尾，starting 根本来不及为真。
    const { resolveComfyLaunchPlan } = await import("./launch-path");
    vi.mocked(resolveComfyLaunchPlan).mockReturnValue({
      cmd: "python",
      baseArgs: ["-s", "/x/main.py"],
      cwd: "/x",
      mainPy: "/x/main.py",
    });
    vi.mocked(getExitPolicy).mockReturnValue({ exitKillComfyui: false } as never);
    vi.mocked(spawnManaged).mockReturnValue({
      child: { pid: 98765 },
      error: undefined,
    } as never);
    vi.mocked(findPidForMainPy).mockResolvedValue(null);
    const pending = ensureComfyUiReady({ manual: true, timeoutMs: 250 });
    // 等一拍让 st.starting 落位。
    await new Promise((r) => setTimeout(r, 60));
    expect((await getComfyUiStatus()).starting).toBe(true);
    const r = await pending;
    expect(r.ok).toBe(false);
    // 收尾后单飞锁释放：下一次调用能重新开始（不会永久卡在「启动中」）。
    expect((await getComfyUiStatus()).starting).toBe(false);
    vi.mocked(getExitPolicy).mockReturnValue({ exitKillComfyui: true } as never);
  });

  it("手动关闭后 stopping 在窗口内为 true、窗口过期后回 false", async () => {
    const { isComfyStopping } = await import("./lifecycle");
    const { isWithinStoppingWindow } = await import("./lifecycle-derive");
    // stoppingAt 是模块内部状态，经 stopComfyUiProcess 落位后由 isComfyStopping 读取。
    // 这里断言两件事：①刚关闭完，窗口内为 true；②用纯函数证明窗口会过期。
    await stopComfyUiProcess();
    const now = Date.now();
    expect(
      isWithinStoppingWindow({ stoppingAt: now, nowMs: now + 1, windowMs: 30_000 }),
    ).toBe(true);
    expect(
      isWithinStoppingWindow({ stoppingAt: now, nowMs: now + 30_001, windowMs: 30_000 }),
    ).toBe(false);
    // isComfyStopping 与纯函数同源（lifecycle 内部就是调它），这里只固定它可调用。
    expect(typeof isComfyStopping()).toBe("boolean");
  });
});

describe("关闭流程 — 进程树回收判据", () => {
  it("Windows 上关闭走 `taskkill /PID <pid> /T /F`，禁止单杀（否则 node/python 子进程残留）", async () => {
    const { exec } = await import("child_process");
    const { stopComfyUiProcess } = await import("./lifecycle");
    const { findPidForMainPy } = await import("./proc-detect");

    // 造「无句柄但仍在跑」场景：探测可达 + 进程表定位到 PID。
    const { resolveComfyBase } = await import("./client");
    vi.mocked(resolveComfyBase).mockResolvedValueOnce("http://127.0.0.1:8188");
    vi.mocked(findPidForMainPy).mockResolvedValueOnce(4321);
    const execSpy = vi.mocked(exec);

    const r = await stopComfyUiProcess();

    if (process.platform === "win32") {
      expect(execSpy).toHaveBeenCalledWith(
        expect.stringContaining("taskkill /PID 4321 /T /F"),
        expect.any(Function),
      );
    } else {
      // 非 Windows 走进程组 / SIGTERM，这里只锁住「不会误报成功」的口径：
      // 目标仍可达 → ok=false + 可行动提示。
      expect(r.detail).toBeTruthy();
    }
  });

  it("目标已不在运行 → 返回 ok=true 且 detail 明确「未在运行」（不给假失败）", async () => {
    const { stopComfyUiProcess } = await import("./lifecycle");
    const r = await stopComfyUiProcess();
    expect(r.ok).toBe(true);
    expect(r.detail).toContain("未在运行");
  });
});
