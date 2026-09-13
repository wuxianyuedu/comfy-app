// 实例端口解析单测（ISSUE #449）。
//
// 为什么值得单独测：这条链子回答的是「配置的实例在不在跑、在哪个端口」，
// 而它以前根本不存在——`resolveComfyBase()` 靠「逐个端口试到有人应答」反推，
// 配置了实例路径也要先探 8188..8193。把「配置路径 → 进程 → 端口」钉成断言，
// 才拦得住「明明配了路径却还在猜端口」的回归。
//
// 三条判据各自对应一种真实起法：
//   · main.py 命中（便携版 / venv）；
//   · setup 登记的启动器 / 解释器候选（comfy-cli 起的实例）；
//   · 环境反查（Comfy Desktop 由 uv 起，命令行里没有 main.py）。

import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("./launch-path", () => ({ resolveComfyLaunchPlan: vi.fn() }));
vi.mock("./instance-kind", () => ({
  classifyComfyInstall: vi.fn(() => ({
    kind: "portable",
    instanceRoot: "C:\\Comfy",
    instanceIdFile: null,
  })),
}));
vi.mock("./proc-detect", () => ({
  findPidForMainPyDetailed: vi.fn(),
  findPidListeningPort: vi.fn(),
}));
vi.mock("./env-python", () => ({ collectComfyPythonCandidates: vi.fn(() => []) }));
vi.mock("./status", () => ({
  readRegisteredLauncher: vi.fn(() => null),
  launcherCommandCandidates: vi.fn(() => []),
}));

import { baseForLocalPort, queryInstanceByPath } from "./instance-port";
import { resolveComfyLaunchPlan } from "./launch-path";
import { findPidForMainPyDetailed, findPidListeningPort } from "./proc-detect";
import { collectComfyPythonCandidates } from "./env-python";
import { readRegisteredLauncher, launcherCommandCandidates } from "./status";

const plan = {
  cmd: "C:\\Comfy\\python_embeded\\python.exe",
  baseArgs: ["-s"],
  cwd: "C:\\Comfy",
  mainPy: "C:\\Comfy\\main.py",
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(resolveComfyLaunchPlan).mockReturnValue(plan);
  vi.mocked(findPidForMainPyDetailed).mockResolvedValue({
    pid: null,
    failed: false,
  });
  vi.mocked(findPidListeningPort).mockResolvedValue(null);
  vi.mocked(collectComfyPythonCandidates).mockReturnValue([]);
  vi.mocked(readRegisteredLauncher).mockReturnValue(null);
  vi.mocked(launcherCommandCandidates).mockReturnValue([]);
  delete process.env.COMFYUI_BASE;
});

describe("queryInstanceByPath — 直接从配置路径拿事实", () => {
  it("main.py 进程命中 → running + 该进程实际监听的端口", async () => {
    vi.mocked(findPidForMainPyDetailed).mockResolvedValue({
      pid: 4242,
      failed: false,
    });
    vi.mocked(findPidListeningPort).mockResolvedValue(8190);
    const q = await queryInstanceByPath("C:\\Comfy");
    expect(q).toMatchObject({
      running: true,
      pid: 4242,
      port: 8190,
      source: "process",
      unverified: false,
    });
    // 关键：没有为「找端口」多探任何地址——端口来自进程，不是猜出来的。
    expect(findPidListeningPort).toHaveBeenCalledWith(4242);
  });

  it("进程在但端口未绑定 → running + port=null（正在加载，不是没在跑）", async () => {
    vi.mocked(findPidForMainPyDetailed).mockResolvedValue({
      pid: 77,
      failed: false,
    });
    vi.mocked(findPidListeningPort).mockResolvedValue(null);
    const q = await queryInstanceByPath("C:\\Comfy");
    expect(q.running).toBe(true);
    expect(q.port).toBeNull();
  });

  it("main.py 落空但解释器候选命中（comfy-cli / 桌面版起法）", async () => {
    vi.mocked(launcherCommandCandidates).mockReturnValue([
      "C:\\Comfy\\python_embeded\\python.exe",
    ]);
    let call = 0;
    // 第 1 次 = main.py（落空），第 2 次 = 解释器候选（命中）
    vi.mocked(findPidForMainPyDetailed).mockImplementation(async () => {
      call += 1;
      return call === 1
        ? { pid: null, failed: false } // main.py 落空
        : { pid: 900, failed: false }; // 解释器候选命中
    });
    vi.mocked(findPidListeningPort).mockResolvedValue(8188);
    const q = await queryInstanceByPath("C:\\Comfy");
    expect(q).toMatchObject({ running: true, pid: 900, source: "process" });
  });

  it("setup 登记的启动器优先于环境反查候选（先声明的判据优先）", async () => {
    vi.mocked(readRegisteredLauncher).mockReturnValue("C:\\uv\\python.exe");
    vi.mocked(collectComfyPythonCandidates).mockReturnValue([
      { exe: "C:\\uv\\other\\python.exe", via: "实例环境的解释器" },
    ]);
    let call = 0;
    vi.mocked(findPidForMainPyDetailed).mockImplementation(async () => {
      call += 1;
      return call === 1
        ? { pid: null, failed: false } // main.py 落空
        : { pid: 555, failed: false }; // 候选命中
    });
    vi.mocked(findPidListeningPort).mockResolvedValue(8188);
    const q = await queryInstanceByPath("C:\\Comfy");
    expect(q.source).toBe("launcher");
    expect(q.via).toBe("setup 中登记的启动器");
  });

  it("查过但一条都没命中 → running=false 且 unverified=false（确认不在跑）", async () => {
    const q = await queryInstanceByPath("C:\\Comfy");
    expect(q.running).toBe(false);
    expect(q.unverified).toBe(false);
  });

  it("进程表查询失败 → unverified=true（不得当成「没在跑」）", async () => {
    vi.mocked(findPidForMainPyDetailed).mockResolvedValue({
      pid: null,
      failed: true,
    });
    const q = await queryInstanceByPath("C:\\Comfy");
    expect(q.running).toBe(false);
    expect(q.unverified).toBe(true);
  });

  it("未配置路径 → 空结果，且不查任何东西", async () => {
    const q = await queryInstanceByPath("   ");
    expect(q.running).toBe(false);
    expect(findPidForMainPyDetailed).not.toHaveBeenCalled();
  });
});

describe("baseForLocalPort — 端口 → 地址", () => {
  it("合法端口 → 回环地址", () => {
    expect(baseForLocalPort(8190)).toBe("http://127.0.0.1:8190");
  });

  it("无端口 / 非法端口 → null（调用方继续走探测链路）", () => {
    expect(baseForLocalPort(null)).toBeNull();
    expect(baseForLocalPort(0)).toBeNull();
    expect(baseForLocalPort(70000)).toBeNull();
  });

  it("COMFYUI_BASE 指向远端实例时不用本机端口事实", () => {
    process.env.COMFYUI_BASE = "http://192.168.1.9:8188";
    expect(baseForLocalPort(8190)).toBeNull();
  });
});
