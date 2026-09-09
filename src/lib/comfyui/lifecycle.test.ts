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
vi.mock("../process-launch", () => ({ spawnManaged: vi.fn(), waitForDetachMediator: vi.fn() }));
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
} from "./lifecycle";
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
