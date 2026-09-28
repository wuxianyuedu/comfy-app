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
import fs from "fs";
import path from "path";

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
/* runEnsureLaunch 的端口冲突用例需要封闭的探测面：./probe（快照的端口探测）、
 * ./client（waitForExistingInstanceReady 经 host 注入的 probe 不走它，但 status
 * 快照链会经 ./probe 拿端口事实；一并钉死避免摸真实本机端口）、./status（快照
 * 结果直接编排）。./status 用**完整 mock**而不是 importOriginal 展开：真实模块
 * 会拉起 ~/lib/core/logger → app-runtime-log → log-paths 的整条链，而本文件对
 * log-paths 的 mock 只给了 SERVICES_LOG_DIR（本文件的用例用不到别的导出）。 */
vi.mock("./client", () => ({
  probeComfyBase: vi.fn().mockResolvedValue(null),
  probeComfyAtPort: vi.fn().mockResolvedValue(null),
  resolveComfyBase: vi.fn().mockRejectedValue(new Error("not running")),
  resetComfyBase: vi.fn(),
}));
vi.mock("./probe", () => ({
  probeComfyAtPort: vi.fn().mockResolvedValue(null),
  probeBaseOnce: vi.fn().mockResolvedValue(null),
}));
vi.mock("./status", () => ({
  getComfyRuntimeSnapshot: vi.fn(),
  launcherCommandCandidates: vi.fn().mockReturnValue([]),
  readRegisteredLauncher: vi.fn().mockReturnValue(null),
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

import { SERVICES_LOG_DIR } from "~/lib/log/log-paths";

import { startComfyExitWatcher } from "./lifecycle-exit";
import {
  ensureKeepAliveWatchOnAdoption,
  pruneKeepAliveLogs,
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

describe("pruneKeepAliveLogs —— 按次命名的保活日志只建不删会一直堆积", () => {
  /* 夹具：造 count 次「拉起」的重定向文件（每次 out+err 两个），
   * mtime 按 i 递减 —— s00 最新、序号越大越老，排序才有确定结论。 */
  function seedLaunches(count: number): void {
    fs.mkdirSync(SERVICES_LOG_DIR, { recursive: true });
    for (let i = 0; i < count; i += 1) {
      for (const suffix of [".out.log", ".err.log"]) {
        const file = path.join(
          SERVICES_LOG_DIR,
          `comfyui-keepalive-s${String(i).padStart(2, "0")}${suffix}`,
        );
        fs.writeFileSync(file, "x");
        const at = (Date.now() - i * 60_000) / 1000;
        fs.utimesSync(file, at, at);
      }
    }
  }

  function keepAliveFiles(): string[] {
    if (!fs.existsSync(SERVICES_LOG_DIR)) return [];
    return fs
      .readdirSync(SERVICES_LOG_DIR)
      .filter((name) => name.startsWith("comfyui-keepalive-"));
  }

  beforeEach(() => {
    for (const name of keepAliveFiles()) {
      fs.unlinkSync(path.join(SERVICES_LOG_DIR, name));
    }
  });

  it("超过保留份数时只留最近 10 次（20 个文件），更老的删掉", () => {
    seedLaunches(14); // 28 个文件
    pruneKeepAliveLogs();
    const left = keepAliveFiles();
    expect(left).toHaveLength(20);
    expect(left).toContain("comfyui-keepalive-s00.out.log"); // 最新的留着
    expect(left).toContain("comfyui-keepalive-s09.err.log");
    expect(left).not.toContain("comfyui-keepalive-s10.out.log"); // 第 11 次起删掉
    expect(left).not.toContain("comfyui-keepalive-s13.err.log");
  });

  it("不足保留份数时一个都不删", () => {
    seedLaunches(3);
    pruneKeepAliveLogs();
    expect(keepAliveFiles()).toHaveLength(6);
  });

  it("只认 comfyui-keepalive-*，别的日志/标记文件不受影响", () => {
    seedLaunches(12);
    const bystander = path.join(SERVICES_LOG_DIR, "comfyui-runtime.log");
    const mark = path.join(SERVICES_LOG_DIR, "comfyui-last-session.json");
    fs.writeFileSync(bystander, "log");
    fs.writeFileSync(mark, "{}");
    pruneKeepAliveLogs();
    expect(fs.existsSync(bystander)).toBe(true);
    expect(fs.existsSync(mark)).toBe(true);
  });
});

describe("runEnsureLaunch —— 保活拉起遇端口被占：识别、中止、转接管", () => {
  beforeEach(() => {
    vi.mocked(getExitPolicy).mockReturnValue({
      exitKillComfyui: false,
      exitKillOllama: false,
    });
    fs.mkdirSync(SERVICES_LOG_DIR, { recursive: true });
  });

  it("重定向 stderr 出现 Port already in use → 中止等待，转等待已有实例就绪", async () => {
    // 现场原文：新进程绑 8188 失败当场退出，这行落在保活重定向 err 文件里。
    fs.writeFileSync(
      path.join(SERVICES_LOG_DIR, "comfyui-keepalive-stamp.err.log"),
      "[INFO] Starting server\n" +
        "[ERROR] Port 8188 is already in use on address 127.0.0.1.\n",
    );
    const { spawnManaged } = await import("~/lib/process/process-launch");
    // spawnManaged 是同步返回（keepAlive 下 child 是中介进程句柄）
    vi.mocked(spawnManaged).mockReturnValue({ child: { pid: 4321 } } as never);
    const { getComfyRuntimeSnapshot } = await import("./status");
    vi.mocked(getComfyRuntimeSnapshot).mockResolvedValue({
      running: true,
      pid: 97356,
      port: 8188,
      via: "配置路径的实例",
      unverified: false,
      didQueryProcTable: true,
      source: "process",
    } as never);

    const { runEnsureLaunch } = await import("./lifecycle-launch");
    const notes: string[] = [];
    /* 探针编排：等待循环第 1 轮（还没读到冲突行之前）应答 null → 置冲突标记；
     * 第 2 轮 earlyExit 中止并转接管 —— 此后实例应答，接管成功。 */
    const host: LaunchHost = {
      st: { stopRequested: false },
      appendRuntimeLog: vi.fn(),
      appendSessionBanner: vi.fn(),
      clearComfyStopping: vi.fn(),
      localTimestamp: () => "stamp",
      markSessionStart: vi.fn(),
      markSessionEnd: vi.fn(),
      probeComfyUi: vi
        .fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValue("http://127.0.0.1:8188"),
    };

    const r = await runEnsureLaunch({
      host,
      settings: getSettingsSync(),
      timeoutMs: 30_000,
      note: (msg) => notes.push(msg),
    });

    expect(r.ok, JSON.stringify({ r, notes })).toBe(true);
    expect(r.detail).toContain("接管");
    // 关键：没有为「接管」再 spawn 第二个进程
    expect(vi.mocked(spawnManaged)).toHaveBeenCalledTimes(1);
    expect(notes.join("\n")).toContain("转为等待该实例就绪");
  });
});
