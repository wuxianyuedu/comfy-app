// 运行态快照的判决测试（ISSUE #339）。
//
// 为什么值得单独测：这里的每一条规则都对应一次「外部明明启动了 ComfyUI，
// 设置页却显示未运行」的误报——
//   · 进程表查询超时不得当成「没在跑」；
//   · 进程活着但端口还没绑定 = 启动中，不是未运行；
//   · 解释器候选要覆盖 pythonw / standalone-env（Comfy Desktop 由 uv 起，
//     命令行里没有 main.py）；
//   · 快照有 TTL 但不长期缓存（外部刚起来的实例必须能被认出来）。
// 这些规则读代码看不出回归，只有把「事实 → 结论」钉成断言才拦得住。

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

vi.mock("../app-settings", () => ({ getSettingsSync: vi.fn() }));
vi.mock("./launch-path", () => ({ resolveComfyLaunchPlan: vi.fn() }));
vi.mock("./instance-kind", () => ({ classifyComfyInstall: vi.fn() }));
vi.mock("./proc-detect", () => ({
  findPidForMainPyDetailed: vi.fn(),
  findPidListeningPort: vi.fn(),
}));
vi.mock("~/server/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import {
  getComfyRuntimeSnapshot,
  resetComfyRuntimeSnapshot,
  setBoundChildPidReader,
  launcherCommandCandidates,
  readRegisteredLauncher,
  COMFY_SNAPSHOT_TTL_MS,
} from "./status";
import { getSettingsSync } from "../app-settings";
import { resolveComfyLaunchPlan } from "./launch-path";
import { classifyComfyInstall } from "./instance-kind";
import { findPidForMainPyDetailed, findPidListeningPort } from "./proc-detect";

const plan = {
  cmd: "C:\\Comfy\\python_embeded\\python.exe",
  baseArgs: ["-s", "C:\\Comfy\\main.py"],
  cwd: "C:\\Comfy",
  mainPy: "C:\\Comfy\\main.py",
};

beforeEach(() => {
  vi.mocked(getSettingsSync).mockReturnValue({
    comfyuiPath: "C:\\Comfy",
    comfyuiPort: 0,
  } as never);
  vi.mocked(resolveComfyLaunchPlan).mockReturnValue(plan);
  vi.mocked(classifyComfyInstall).mockReturnValue({
    kind: "portable",
    instanceRoot: "C:\\Comfy",
    instanceIdFile: null,
  } as never);
  vi.mocked(findPidForMainPyDetailed).mockResolvedValue({ pid: null, failed: false });
  vi.mocked(findPidListeningPort).mockResolvedValue(null);
  // 快照挂在 globalThis（HMR 单例）+ mock 调用历史都是跨用例共享的：
  // 逐用例重置，否则「未调用」类断言会被上一个用例的调用污染。
  vi.clearAllMocks();
  resetComfyRuntimeSnapshot();
  setBoundChildPidReader(() => null);
});

afterEach(() => {
  setBoundChildPidReader(() => null);
});

describe("getComfyRuntimeSnapshot — 外部实例也要认出来", () => {
  it("配置路径进程表命中即「在跑」，并带出监听端口", async () => {
    vi.mocked(findPidForMainPyDetailed).mockResolvedValue({ pid: 4242, failed: false });
    vi.mocked(findPidListeningPort).mockResolvedValue(8188);
    const snap = await getComfyRuntimeSnapshot({ force: true });
    expect(snap.running).toBe(true);
    expect(snap.pid).toBe(4242);
    expect(snap.port).toBe(8188);
    expect(snap.source).toBe("process");
    expect(snap.unverified).toBe(false);
  });

  it("进程表查询失败（超时/高负载）→ unverified，绝不当成「没在跑」", async () => {
    vi.mocked(findPidForMainPyDetailed).mockResolvedValue({ pid: null, failed: true });
    const snap = await getComfyRuntimeSnapshot({ force: true });
    expect(snap.running).toBe(false);
    expect(snap.unverified).toBe(true);
  });

  it("解释器候选落空但 setup 登记的启动器命中（Comfy Desktop / uv 起法）", async () => {
    // 主 main.py 查询成功返回「没有」，登记的启动器命中。
    vi.mocked(findPidForMainPyDetailed).mockImplementation(async (needle: string) =>
      needle.includes("uv.exe") ? { pid: 777, failed: false } : { pid: null, failed: false },
    );
    vi.mocked(findPidListeningPort).mockResolvedValue(8190);
    // 把登记启动器伪装成 uv.exe：用一个真实存在的小文件承载 .comfy-cli 内容。
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "comfycli-"));
    const cliDir = path.join(dir, ".venv", "Lib", "site-packages", "comfy_cli");
    fs.mkdirSync(cliDir, { recursive: true });
    fs.writeFileSync(
      path.join(cliDir, ".comfy-cli"),
      JSON.stringify({ setup: { cmds: '"C:\\\\uv\\\\uv.exe" run main.py' } }),
      "utf8",
    );
    vi.mocked(getSettingsSync).mockReturnValue({ comfyuiPath: dir, comfyuiPort: 0 } as never);
    vi.mocked(resolveComfyLaunchPlan).mockReturnValue({
      ...plan,
      mainPy: path.join(dir, "main.py"),
    });
    vi.mocked(classifyComfyInstall).mockReturnValue({
      kind: "desktop",
      instanceRoot: dir,
      instanceIdFile: null,
    } as never);

    const snap = await getComfyRuntimeSnapshot({ force: true });
    expect(snap.running).toBe(true);
    expect(snap.source).toBe("launcher");
    expect(snap.via).toContain("启动器");
  });

  it("本进程 bound 子进程优先：不经任何进程表查询即判定在跑", async () => {
    setBoundChildPidReader(() => 31337);
    vi.mocked(findPidListeningPort).mockResolvedValue(8188);
    const snap = await getComfyRuntimeSnapshot({ force: true });
    expect(snap.running).toBe(true);
    expect(snap.source).toBe("bound");
    expect(snap.pid).toBe(31337);
    expect(findPidForMainPyDetailed).not.toHaveBeenCalled();
  });

  it("未配置路径且无 bound 子进程 → 未运行", async () => {
    vi.mocked(getSettingsSync).mockReturnValue({ comfyuiPath: "", comfyuiPort: 0 } as never);
    const snap = await getComfyRuntimeSnapshot({ force: true });
    expect(snap.running).toBe(false);
    expect(snap.unverified).toBe(false);
  });
});

describe("快照缓存 — 便宜但不失时效", () => {
  it("TTL 内复用同一结果，不在途重复查进程表", async () => {
    vi.mocked(findPidForMainPyDetailed).mockResolvedValue({ pid: 1, failed: false });
    await getComfyRuntimeSnapshot({ force: true });
    const calls = vi.mocked(findPidForMainPyDetailed).mock.calls.length;
    await getComfyRuntimeSnapshot();
    expect(vi.mocked(findPidForMainPyDetailed).mock.calls.length).toBe(calls);
  });

  it("force 绕过 TTL：外部刚启动的实例立刻能被认出来", async () => {
    vi.mocked(findPidForMainPyDetailed).mockResolvedValue({ pid: null, failed: false });
    const first = await getComfyRuntimeSnapshot({ force: true });
    expect(first.running).toBe(false);
    vi.mocked(findPidForMainPyDetailed).mockResolvedValue({ pid: 99, failed: false });
    const second = await getComfyRuntimeSnapshot({ force: true });
    expect(second.running).toBe(true);
  });

  it("TTL 很短（秒级）：不会长时间沿用旧结论", () => {
    expect(COMFY_SNAPSHOT_TTL_MS).toBeLessThanOrEqual(3_000);
  });
});

describe("launcherCommandCandidates — 覆盖 pythonw 与桌面 standalone-env", () => {
  it("同一环境目录内枚举 pythonw / python / 原解释器", () => {
    const exe = path.join("comfy", "python_embeded", "python.exe");
    const dir = path.dirname(exe);
    const list = launcherCommandCandidates(exe);
    // 同目录内枚举 pythonw / python，并带上原解释器；重复项已去重。
    expect(list).toContain(exe);
    expect(new Set(list).size).toBe(list.length);
    expect(list.length).toBeGreaterThan(1);
    expect(list.some((c) => c.startsWith(dir) && c.includes('pythonw'))).toBe(true);
  });
});

describe("readRegisteredLauncher — 读不到就静默返回 null", () => {
  it("路径不存在 → null", () => {
    expect(readRegisteredLauncher(path.join(os.tmpdir(), "definitely-missing-xyz"))).toBeNull();
  });
});
