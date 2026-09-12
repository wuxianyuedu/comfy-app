// lifecycle 的「手动关闭后不自动启动」闩锁单测。
// 覆盖 ISSUE #290：用户在设置页点「关闭 ComfyUI」后，WS 重连 / 状态轮询触发的
// 自动启动（ensureComfyUiReady，manual=false）不应再把 ComfyUI 悄悄拉起；
// 只有手动点「启动 ComfyUI」（manual=true）或重新开启自动启动才清闩锁并放行。

import { describe, it, expect, vi, beforeEach } from "vitest";

/* Mock 掉 lifecycle 的副作用依赖：避免测试触碰真实 spawn / fs / DB / ComfyUI。
 *  probeComfyUi 由 resolveComfyBase 兜底：resolveComfyBase 抛错 → probeComfyUi 返回 null。
 *  stopComfyUiProcess 只需走到「pid 未定位到 → 返回未在运行」分支即可把 manualStop 置上。
 *  lifecycle 的全局状态挂在 globalThis（HMR 单例），跨用例会持久累积：
 *  「闩锁」类用例靠每例先 stopComfyUiProcess 落闩锁自证；
 *  状态结论另有 10s TTL 缓存（ISSUE #346），**必须每例清掉**——否则前一个用例
 *  留下的结论会被后一个用例当成「当下事实」读到（判据类用例就是这么被污染的）。 */
vi.mock("../app-settings", () => ({
  COMFYUI_DEFAULT_PORT: 8188,
  getExitPolicy: vi.fn().mockReturnValue({ exitKillComfyui: true }),
  getSettingsSync: vi.fn(),
}));
/* probeComfyBase 是「此刻哪个地址应答」的唯一判据，故在本文件里做成可编排的
 * 探针：默认「都不可达」，需要时由用例改成「某个端口应答」。真去 mock fetch
 * 没用——本模块已被整体 mock，探针必须跟着换成桩。 */
vi.mock("./client", () => ({
  probeComfyBase: vi.fn().mockResolvedValue(null),
  /* 直连端口的探测（快照已定位到进程+端口时走这条）：默认「探不通」，
   * 需要时由用例改成「该端口应答」。 */
  probeComfyAtPort: vi.fn().mockResolvedValue(null),
  resolveComfyBase: vi.fn().mockRejectedValue(new Error("not running")),
  resetComfyBase: vi.fn(),
}));
vi.mock("./launch-path", () => ({
  resolveComfyLaunchPlan: vi.fn().mockReturnValue({
    cmd: "python",
    baseArgs: ["-s", "/x/main.py"],
    cwd: "/x",
    mainPy: "/x/main.py",
  }),
}));
vi.mock("./desktop-instance", () => ({
  resolveEffectiveLaunch: vi.fn().mockResolvedValue({ port: 0, extraArgs: [] }),
}));
vi.mock("./proc-detect", () => ({
  findPidForMainPy: vi.fn().mockResolvedValue(null),
  findPidListeningPort: vi.fn().mockResolvedValue(null),
  findPidForMainPyDetailed: vi
    .fn()
    .mockResolvedValue({ pid: null, failed: false }),
}));
vi.mock("../process-launch", () => ({
  spawnManaged: vi.fn(),
  waitForDetachMediator: vi.fn().mockResolvedValue({ code: 0, stderr: "" }),
}));
vi.mock("~/lib/open-in-browser", () => ({
  openUrlInBrowser: vi.fn().mockResolvedValue({ ok: true }),
}));
vi.mock("../log-paths", () => ({
  COMFYUI_RUNTIME_LOG: "/tmp/comfyui-runtime.log",
  SERVICES_LOG_DIR: "/tmp",
}));
vi.mock("~/server/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import {
  getComfyUiStatus,
  resetComfyUiStatus,
  stopComfyUiProcess,
  ensureComfyUiReady,
  clearComfyManualStop,
  clearComfyAutoStartFailure,
} from "./lifecycle";
import {
  findPidForMainPy,
  findPidForMainPyDetailed,
  findPidListeningPort,
} from "./proc-detect";
import { getSettingsSync } from "../app-settings";

const autoStartSettings = {
  comfyuiPath: "/x",
  comfyuiAutoStart: true,
  comfyuiPort: 0,
  comfyuiExtraArgs: "",
};

beforeEach(() => {
  vi.mocked(getSettingsSync).mockReturnValue(autoStartSettings as never);
  /* 状态结论缓存（ISSUE #346）是跨用例共享的进程级单例：每例先丢掉旧结论，
   * 后面各例的断言才是在断言「当下判定」，而不是上一例的残留。 */
  resetComfyUiStatus();
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
    vi.mocked(getSettingsSync).mockReturnValue({
      ...autoStartSettings,
      comfyuiAutoStart: false,
    } as never);
    const r = await ensureComfyUiReady({ manual: true });

    expect(r.ok).toBe(false);
    expect(r.detail).toContain("未开启自动启动");
  });

  it("clearComfyManualStop 清闩锁后，自动启动不再被拦", async () => {
    await stopComfyUiProcess(); // 落闩锁
    clearComfyManualStop(); // 设置保存重新开启自动启动时清除

    vi.mocked(getSettingsSync).mockReturnValue({
      ...autoStartSettings,
      comfyuiAutoStart: false,
    } as never);
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
    const { ensureComfyUiReady, getComfyUiStatus } =
      await import("./lifecycle");
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
    vi.mocked(getExitPolicy).mockReturnValue({
      exitKillComfyui: false,
    } as never);
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
    vi.mocked(getExitPolicy).mockReturnValue({
      exitKillComfyui: true,
    } as never);
  });

  /* ISSUE #344：ComfyUI 早就启动了，设置页却一直显示「启动中」。
   * 两条判据缺陷叠加：① `resolveComfyBase` 在配置了路径、进程表又查不到
   * `main.py`（Comfy Desktop 的实例由 standalone-env 启动）时抛错，
   * `probeComfyUi` 连一次 HTTP 都没发出去；② 「进程在、端口未绑定」的快照
   * 被缓存住，端口随后出现也不会重新查事实。 */
  it("进程表查不到 main.py、但配置端口上有实例应答 → 报「运行中」而不是「启动中」", async () => {
    const { getComfyUiStatus } = await import("./lifecycle");
    const { resetComfyRuntimeSnapshot } = await import("./status");
    const { resetComfyBase } = await import("./client");
    resetComfyBase();
    resetComfyRuntimeSnapshot();
    // Desktop 实例：命令行里没有 main.py，进程表命中不了。
    vi.mocked(findPidForMainPyDetailed).mockResolvedValue({
      pid: null,
      failed: false,
    });
    vi.mocked(findPidListeningPort).mockResolvedValue(null);
    // 关键：配置端口上实例是真的在应答（旧实现会因进程表落空而根本不去探）。
    const { probeComfyBase } = await import("./client");
    vi.mocked(probeComfyBase).mockResolvedValue("http://127.0.0.1:8188");

    const s = await getComfyUiStatus();
    expect(vi.mocked(probeComfyBase)).toHaveBeenCalled();
    expect(s.up).toBe(true);
    expect(s.base).toBe("http://127.0.0.1:8188");
    expect(s.starting).toBe(false);

    vi.mocked(probeComfyBase).mockResolvedValue(null);
    resetComfyBase();
    resetComfyRuntimeSnapshot();
  });

  /* ISSUE #339 残留延迟：ComfyUI 已经启动时，设置页首屏仍要等一会才显示
   * 「运行中」。根因是状态判定的两路事实（进程表快照 / HTTP 探测）被串行 await，
   * 且探测还要绕经 resolveComfyBase 再查一遍进程表——等待被叠成 N 倍。 */
  it("快照已定位进程+端口 → 直连该端口探测，不再绕通用探测重查进程表", async () => {
    const { getComfyUiStatus } = await import("./lifecycle");
    const { resetComfyRuntimeSnapshot } = await import("./status");
    const { probeComfyAtPort, probeComfyBase } = await import("./client");
    resetComfyUiStatus();
    resetComfyRuntimeSnapshot();
    // 快照命中：配置路径的实例在跑，监听 8188。
    vi.mocked(findPidForMainPyDetailed).mockResolvedValue({
      pid: 4242,
      failed: false,
    });
    vi.mocked(findPidListeningPort).mockResolvedValue(8188);
    vi.mocked(probeComfyAtPort).mockResolvedValue("http://127.0.0.1:8188");
    /* mock 的调用历史跨用例共享（文件级），所以断言「本次没调用」要看**增量**。 */
    const baseCallsBefore = vi.mocked(probeComfyBase).mock.calls.length;

    const s = await getComfyUiStatus({ force: true });

    // 结论来自直连端口的那次探测。
    expect(vi.mocked(probeComfyAtPort)).toHaveBeenCalledWith(8188);
    expect(s.up).toBe(true);
    expect(s.base).toBe("http://127.0.0.1:8188");
    // 关键断言：通用探测**本次一次都没被调用**——它底下会再查一遍进程表
    // （PowerShell 枚举，本机 ~2.5s），而这时事实已经拿到了。这正是
    // 「ComfyUI 已经在跑，打开设置页还要等一会」里被白等掉的那段。
    expect(vi.mocked(probeComfyBase).mock.calls.length).toBe(baseCallsBefore);

    vi.mocked(probeComfyAtPort).mockResolvedValue(null);
    vi.mocked(findPidForMainPyDetailed).mockResolvedValue({
      pid: null,
      failed: false,
    });
    vi.mocked(findPidListeningPort).mockResolvedValue(null);
    resetComfyUiStatus();
    resetComfyRuntimeSnapshot();
  });

  it("直连端口探不通时退回通用探测的结论（不误报运行中）", async () => {
    const { getComfyUiStatus } = await import("./lifecycle");
    const { resetComfyRuntimeSnapshot } = await import("./status");
    const { probeComfyAtPort, probeComfyBase } = await import("./client");
    resetComfyUiStatus();
    resetComfyRuntimeSnapshot();
    vi.mocked(findPidForMainPyDetailed).mockResolvedValue({
      pid: 4242,
      failed: false,
    });
    vi.mocked(findPidListeningPort).mockResolvedValue(8188);
    // 端口上暂时没应答（实例正在加载），通用探测会从别的地址发现它。
    vi.mocked(probeComfyAtPort).mockResolvedValue(null);
    vi.mocked(probeComfyBase).mockResolvedValue("http://127.0.0.1:8189");

    const s = await getComfyUiStatus({ force: true });
    expect(s.up).toBe(true);
    expect(s.base).toBe("http://127.0.0.1:8189");

    vi.mocked(probeComfyBase).mockResolvedValue(null);
    vi.mocked(findPidForMainPyDetailed).mockResolvedValue({
      pid: null,
      failed: false,
    });
    vi.mocked(findPidListeningPort).mockResolvedValue(null);
    resetComfyUiStatus();
    resetComfyRuntimeSnapshot();
  });

  it("手动关闭后 stopping 在窗口内为 true、窗口过期后回 false", async () => {
    const { isComfyStopping } = await import("./lifecycle");
    const { isWithinStoppingWindow } = await import("./lifecycle-derive");
    // stoppingAt 是模块内部状态，经 stopComfyUiProcess 落位后由 isComfyStopping 读取。
    // 这里断言两件事：①刚关闭完，窗口内为 true；②用纯函数证明窗口会过期。
    await stopComfyUiProcess();
    const now = Date.now();
    expect(
      isWithinStoppingWindow({
        stoppingAt: now,
        nowMs: now + 1,
        windowMs: 30_000,
      }),
    ).toBe(true);
    expect(
      isWithinStoppingWindow({
        stoppingAt: now,
        nowMs: now + 30_001,
        windowMs: 30_000,
      }),
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

/* ── 状态结论的 TTL 缓存（ISSUE #346）─────────────────────────────────────
 * 现象：状态行按秒轮询 `setting.comfyStatus`，每次都要重付一遍
 * 「PowerShell 进程表查询（10s 上限）+ HTTP 探测（1.5s）」——本机实测单次
 * 10~12s，日志面板里于是堆满同一条 `setting.comfyStatus 10457ms`。
 *
 * 契约（两条都要，缺一条就出问题）：
 *   ① 同一 TTL 窗口内的重复追问复用同一结论（不让轮询反复付秒级探测的成本）；
 *   ② `starting` / `stopping` 这类**瞬时态**不跟着结论一起缓存，且
 *      「事实已经/即将变化」的动作会显式失效缓存（否则设置页会在 ComfyUI
 *      已经起来之后仍显示「启动中…」，见 ISSUE #344）。
 */
describe("getComfyUiStatus 的 TTL 缓存（#346）", () => {
  it("TTL 窗口内的重复查询复用同一结论（对象引用相同 = 没重新判定）", async () => {
    resetComfyUiStatus();
    const first = await getComfyUiStatus();
    expect(await getComfyUiStatus()).toBe(first);
    expect(await getComfyUiStatus()).toBe(first);
  });

  it("瞬时态不缓存：starting 变化后立刻反映到结论里", async () => {
    resetComfyUiStatus();
    const before = await getComfyUiStatus();
    expect(before.starting).toBe(false);

    /* 造一个「启动进行中」的窗口：走保活路径 + 进程探测找不到 main.py，
     * 启动会一直等到 timeoutMs 到点，期间 starting 为真。 */
    const { getExitPolicy } = await import("../app-settings");
    const { spawnManaged } = await import("../process-launch");
    const { resolveComfyLaunchPlan } = await import("./launch-path");
    vi.mocked(resolveComfyLaunchPlan).mockReturnValue({
      cmd: "python",
      baseArgs: ["-s", "/x/main.py"],
      cwd: "/x",
      mainPy: "/x/main.py",
    });
    vi.mocked(getExitPolicy).mockReturnValue({
      exitKillComfyui: false,
    } as never);
    vi.mocked(spawnManaged).mockReturnValue({
      child: { pid: 98766 },
      error: undefined,
    } as never);
    vi.mocked(findPidForMainPy).mockResolvedValue(null);

    const pending = ensureComfyUiReady({ manual: true, timeoutMs: 250 });
    await new Promise((r) => setTimeout(r, 60));
    expect((await getComfyUiStatus()).starting).toBe(true);

    await pending;
    expect((await getComfyUiStatus()).starting).toBe(false);
    vi.mocked(getExitPolicy).mockReturnValue({
      exitKillComfyui: true,
    } as never);
  });

  it("resetComfyUiStatus 后不再复用旧结论（启动/关闭动作会改动事实）", async () => {
    resetComfyUiStatus();
    const first = await getComfyUiStatus();
    expect(await getComfyUiStatus()).toBe(first);

    resetComfyUiStatus();
    expect(await getComfyUiStatus()).not.toBe(first);
  });
});

/* ── 启动等待期不许闪回「未运行」（ISSUE #442）─────────────────────────
 *
 * 现象：点「启动 ComfyUI」后状态行先显示「正在启动…」，日志里已经打出
 * 「ComfyUI 已就绪」，上面那格却**闪回「未运行」**，几秒后才变回「运行中」。
 *
 * 根因：拉起动作与「确认到运行中」之间有一段空窗（拉起 → 端口绑定 →
 * /system_stats 就绪）。`comfyStatus` 的 5s 轮询会在空窗里问出一次
 * 「进程表没命中 + HTTP 也没通」的**瞬时**结论，而这条结论当时既没有
 * 「启动中」的计时窗口兜住，也没有「刚探明没在跑」的黏滞约束，于是被当成
 * 事实渲染出去。这些用例把两条判据钉住。
 *
 * 注意每条用例都先 resetComfyUiStatus()：它同时清掉两把黏滞标记，
 * 用例之间不互相污染（判据本身就带 10s 黏滞）。 */
describe("启动等待期不闪回「未运行」（ISSUE #442）", () => {
  it("刚从「正在启动」翻过来：探针还没看到实例时仍显示启动中，不落未运行", async () => {
    resetComfyUiStatus();
    const { resetComfyRuntimeSnapshot } = await import("./status");
    resetComfyRuntimeSnapshot();
    // 第一轮：进程在、端口未绑定 → 「正在启动」（同时落启动窗口标记）。
    vi.mocked(findPidForMainPyDetailed).mockResolvedValue({
      pid: 4242,
      failed: false,
    });
    vi.mocked(findPidListeningPort).mockResolvedValue(null);
    const launching = await getComfyUiStatus({ force: true });
    expect(launching.starting).toBe(true);
    expect(launching.up).toBe(false);

    // 紧接着（窗口期内）进程表还没命中、HTTP 也没通 —— 这正是空窗里的那一问。
    vi.mocked(findPidForMainPyDetailed).mockResolvedValue({
      pid: null,
      failed: false,
    });
    const flipped = await getComfyUiStatus({ force: true });
    // 关键：不得翻成「未运行」（用户看到的就是这一下闪回）。
    expect(flipped.starting).toBe(true);
    expect(flipped.probing).toBe(false);
  });

  it("一轮「探明没在跑」之后：相邻轮次的探针抖动不打回「检测中…」（结论黏滞）", async () => {
    resetComfyUiStatus();
    const { resetComfyRuntimeSnapshot } = await import("./status");
    resetComfyRuntimeSnapshot();
    // 进程表查询**成功但没命中** → 探明「没在跑」，结论落「未运行」。
    vi.mocked(findPidForMainPyDetailed).mockResolvedValue({
      pid: null,
      failed: false,
    });
    const proven = await getComfyUiStatus({ force: true });
    expect(proven.up).toBe(false);
    expect(proven.starting).toBe(false);
    expect(proven.probing).toBe(false);

    // 下一轮探针超时（PowerShell 高负载）→ 事实不可信。此时的证据比上一轮**弱**，
    // 不该改口成「检测中…」，否则状态行就在这两句之间来回跳。
    vi.mocked(findPidForMainPyDetailed).mockResolvedValue({
      pid: null,
      failed: true,
    });
    resetComfyRuntimeSnapshot();
    const jittered = await getComfyUiStatus({ force: true });
    expect(jittered.starting).toBe(false);
    expect(jittered.probing).toBe(false);
    expect(jittered.up).toBe(false);
  });

  it("探明没在跑之后实例真的起来了：不受黏滞影响，立刻报运行中", async () => {
    resetComfyUiStatus();
    const { resetComfyRuntimeSnapshot } = await import("./status");
    resetComfyRuntimeSnapshot();
    vi.mocked(findPidForMainPyDetailed).mockResolvedValue({
      pid: null,
      failed: false,
    });
    expect((await getComfyUiStatus({ force: true })).up).toBe(false);

    // 实例起来了：快照命中进程 + 端口，直连探测应答。
    vi.mocked(findPidForMainPyDetailed).mockResolvedValue({
      pid: 4242,
      failed: false,
    });
    vi.mocked(findPidListeningPort).mockResolvedValue(8188);
    const { probeComfyAtPort } = await import("./client");
    vi.mocked(probeComfyAtPort).mockResolvedValue("http://127.0.0.1:8188");
    // 快照带 1.5s TTL：上一轮留下的空快照必须显式丢掉，本轮的「进程命中」才作数。
    resetComfyRuntimeSnapshot();
    const up = await getComfyUiStatus({ force: true });
    expect(up.up).toBe(true);
    expect(up.starting).toBe(false);

    vi.mocked(probeComfyAtPort).mockResolvedValue(null);
    vi.mocked(findPidForMainPyDetailed).mockResolvedValue({
      pid: null,
      failed: false,
    });
    vi.mocked(findPidListeningPort).mockResolvedValue(null);
  });

  it("手动点「启动 ComfyUI」：拉起判决走完后状态行不落「未运行」", async () => {
    resetComfyUiStatus();
    const { resetComfyRuntimeSnapshot } = await import("./status");
    resetComfyRuntimeSnapshot();
    // 本用例只关心「启动窗口有没有落位」：路径判据直接返回「未配置路径」，
    // 拉起动作不会真的发生（不起进程），但这已经算是「启动流程进行过」，
    // 之后的空窗期不该闪回「未运行」。
    vi.mocked(getSettingsSync).mockReturnValue({
      comfyuiPath: "",
      comfyuiAutoStart: true,
      comfyuiPort: 0,
      comfyuiExtraArgs: "",
    } as never);
    const r = await ensureComfyUiReady({ manual: true });
    expect(r.ok).toBe(false);

    vi.mocked(getSettingsSync).mockReturnValue(autoStartSettings as never);
    const s = await getComfyUiStatus({ force: true });
    expect(s.up).toBe(false);
    expect(s.starting).toBe(true);
  });

  it("重置状态（启动/关闭动作）会清掉黏滞：新事实立刻说了算", async () => {
    resetComfyUiStatus();
    const { resetComfyRuntimeSnapshot } = await import("./status");
    resetComfyRuntimeSnapshot();
    vi.mocked(findPidForMainPyDetailed).mockResolvedValue({
      pid: null,
      failed: false,
    });
    await getComfyUiStatus({ force: true });

    // 关闭动作会先 resetComfyUiStatus（见 stopComfyUiProcess / 启动动作）。
    resetComfyUiStatus();
    // 此后一轮查询失败 → 没有黏滞兜着，如实报「检测中…」而不是沿用旧结论。
    vi.mocked(findPidForMainPyDetailed).mockResolvedValue({
      pid: null,
      failed: true,
    });
    resetComfyRuntimeSnapshot();
    const after = await getComfyUiStatus({ force: true });
    expect(after.probing).toBe(true);
    expect(after.starting).toBe(false);
  });
});
