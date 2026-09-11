// `resolveComfyBase()` / `probeComfyBase()` 的判据测试（ISSUE #344）。
//
// 为什么值得单独测：这两条链路的分工读代码看不出回归，而写错的表现是
// 「ComfyUI 明明在运行，设置页却永远显示『正在启动…』」——
//   · `resolveComfyBase()` 是**粘性**会话结论（命中后不再复查），供提交/上传
//     等 mutation 复用；它越权判「实例没在跑」会让 HTTP 探测一次都发不出去。
//   · `probeComfyBase()` 是**按次**探测，只回答「此刻哪个地址应答」，
//     不得污染会话结论。
//
// 覆盖两条真实误报：
//   1. 配置了 comfyuiPath 但进程表里查不到 main.py（Comfy Desktop 的实例由
//      standalone-env 启动，命令行里没有 main.py）→ 不再抛错，退回端口探测；
//   2. 「进程在、端口未绑定」的启动中结论不得写进会话缓存，否则 ComfyUI
//      随后就绪时本进程仍沿用连不上的配置地址。

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

vi.mock("../app-settings", () => ({
  COMFYUI_DEFAULT_PORT: 8188,
  getSettingsSync: vi.fn(),
}));
vi.mock("./proc-detect", () => ({
  findPidForMainPyDetailed: vi.fn(),
  findPidListeningPort: vi.fn(),
}));
vi.mock("./launch-path", () => ({ resolveComfyLaunchPlan: vi.fn() }));
vi.mock("~/server/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { resolveComfyBase, probeComfyBase, resetComfyBase } from "./client";
import { getSettingsSync } from "../app-settings";
import { findPidForMainPyDetailed, findPidListeningPort } from "./proc-detect";
import { resolveComfyLaunchPlan } from "./launch-path";

const plan = {
  cmd: "D:\\Comfy\\ComfyUI\\.venv\\Scripts\\python.exe",
  baseArgs: ["-s", "D:\\Comfy\\ComfyUI\\main.py"],
  cwd: "D:\\Comfy\\ComfyUI",
  mainPy: "D:\\Comfy\\ComfyUI\\main.py",
};

/** 只让指定端口应答 `/system_stats`，其余连接一律拒绝。 */
function respondOn(ports: number[]) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input: unknown) => {
    const url = String(input);
    if (ports.some((p) => url.includes(`:${p}/`))) {
      return new Response("{}", { status: 200 });
    }
    throw new Error("ECONNREFUSED");
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  resetComfyBase();
  vi.mocked(getSettingsSync).mockReturnValue({
    comfyuiPath: "D:\\Comfy",
    comfyuiPort: 8188,
  } as never);
  vi.mocked(resolveComfyLaunchPlan).mockReturnValue(plan);
  vi.mocked(findPidForMainPyDetailed).mockResolvedValue({ pid: null, failed: false });
  vi.mocked(findPidListeningPort).mockResolvedValue(null);
});

afterEach(() => {
  resetComfyBase();
  vi.restoreAllMocks();
});

describe("resolveComfyBase — 进程表查不到 main.py 时退回端口探测", () => {
  it("Comfy Desktop 实例（命令行无 main.py）在 8188 应答 → 认出该地址", async () => {
    // Desktop 的 standalone-env 由 uv 启动、命令行里没有 main.py：
    // 进程表查询命中不了，但端口上实例是真的在跑。
    respondOn([8188]);
    await expect(resolveComfyBase()).resolves.toBe("http://127.0.0.1:8188");
  });

  it("端口全不可达 → 回落配置地址（调用方的 503 由 HTTP 层产生，不再是抛错）", async () => {
    respondOn([]);
    await expect(resolveComfyBase()).resolves.toBe("http://127.0.0.1:8188");
  });
});

describe("probeComfyBase — 按次探测，不污染会话缓存", () => {
  it("「进程在、端口未绑定」的启动中结论不写进缓存：端口就绪后立刻能探到", async () => {
    vi.mocked(findPidForMainPyDetailed).mockResolvedValue({ pid: 100, failed: false });
    const fetchSpy = respondOn([]);
    // 启动中：配置地址上还没有实例应答
    await expect(probeComfyBase()).resolves.toBeNull();

    // ComfyUI 加载完成、开始监听
    fetchSpy.mockRestore();
    respondOn([8188]);
    await expect(probeComfyBase()).resolves.toBe("http://127.0.0.1:8188");
  });

  it("探测到偏移端口时不改会话结论：mutation 仍用 resolveComfyBase 自己的判断", async () => {
    respondOn([8189]);
    await expect(probeComfyBase()).resolves.toBe("http://127.0.0.1:8189");
    // 会话缓存没被这次探测改写（下次 resolve 重新按自己的链路判定）。
    await expect(resolveComfyBase()).resolves.toBe("http://127.0.0.1:8189");
  });
});
