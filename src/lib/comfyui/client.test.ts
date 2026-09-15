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

vi.mock("../app-settings/app-settings.server", () => ({
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

import {
  resolveComfyBase,
  probeComfyBase,
  resetComfyBase,
  resetProbeMissLog,
  COMFY_PROBE_LOG_REPEAT_MS,
} from "./client";
import { getSettingsSync } from "../app-settings/app-settings.server";
import { findPidForMainPyDetailed, findPidListeningPort } from "./proc-detect";
import { resolveComfyLaunchPlan } from "./launch-path";
import { logger } from "~/server/lib/logger";

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
  resetProbeMissLog();
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
  resetProbeMissLog();
  vi.restoreAllMocks();
});

/** logger.warn 里有没有一条命中 `pattern` 的行。 */
function warned(pattern: RegExp): boolean {
  return vi
    .mocked(logger.warn)
    .mock.calls.some(([msg]) => pattern.test(String(msg)));
}

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

describe("resolveComfyBase — 先问进程事实，再谈探测（ISSUE #449）", () => {
  it("按配置路径拿到进程与实际监听端口 → 直接连它，不再逐个试端口", async () => {
    // 实例真实监听 8189（桌面里改过端口），而设置里的「端口」还是 8188：
    // 旧流程会先探 8188、再依次试 8189..8193；新流程第一跳就问进程拿到 8189。
    vi.mocked(findPidForMainPyDetailed).mockResolvedValue({
      pid: 4321,
      failed: false,
    });
    vi.mocked(findPidListeningPort).mockResolvedValue(8189);
    const fetchSpy = respondOn([8189]);
    await expect(resolveComfyBase()).resolves.toBe("http://127.0.0.1:8189");
    // 端口来自进程（PID 4321 的监听端口），不是探出来的
    expect(findPidListeningPort).toHaveBeenCalledWith(4321);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("进程在跑但端口未绑定 → 回落配置地址且不缓存该结论（下次重新问）", async () => {
    vi.mocked(findPidForMainPyDetailed).mockResolvedValue({
      pid: 777,
      failed: false,
    });
    vi.mocked(findPidListeningPort).mockResolvedValue(null);
    respondOn([]);
    await expect(resolveComfyBase()).resolves.toBe("http://127.0.0.1:8188");
    // 结论没被缓存：实例稍后绑定端口时应重新问（而不是沿用这个连不上的地址）。
    resetComfyBase();
    vi.mocked(findPidListeningPort).mockResolvedValue(8188);
    const fetchSpy = respondOn([8188]);
    await expect(resolveComfyBase()).resolves.toBe("http://127.0.0.1:8188");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("进程表查询失败（超时/高负载）→ 不判「没在跑」，退回端口探测", async () => {
    vi.mocked(findPidForMainPyDetailed).mockResolvedValue({
      pid: null,
      failed: true,
    });
    respondOn([8189]);
    await expect(resolveComfyBase()).resolves.toBe("http://127.0.0.1:8189");
    expect(warned(/Process lookup failed/)).toBe(true);
  });

  it("查询成功但没命中 → 退回端口探测（Comfy Desktop 由 uv 起，命令行未必有 main.py）", async () => {
    respondOn([8188]);
    await expect(resolveComfyBase()).resolves.toBe("http://127.0.0.1:8188");
    expect(warned(/No running instance process found/)).toBe(true);
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

describe("探测全落空 — 只说「没探到这批地址」，且不刷屏", () => {
  it("降为 warn 而不是 error，并在文案里交代「不代表实例没在运行」", async () => {
    // 现场：ComfyUI 在跑但不在「配置地址 + 就近偏移 + 窗口地址」这批地址上
    // （用户在 ComfyUI 侧改过端口 / 另有一套启动方式）。此前这条记成 error，
    // 用户读到「ComfyUI 已经在 8188 运行着却报 error」——把一次「没探到」
    // 说成了故障。
    respondOn([9999]);
    await resolveComfyBase();
    expect(warned(/Cannot reach ComfyUI/)).toBe(true);
    expect(warned(/不代表实例没在运行/)).toBe(true);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("汇总行写清「问过哪些地址」：配置端口 + 就近偏移 + 窗口端口", async () => {
    respondOn([]);
    await resolveComfyBase();
    const line = vi
      .mocked(logger.warn)
      .mock.calls.map(([m]) => String(m))
      .find((m) => m.includes("Cannot reach ComfyUI"))!;
    // 排查需要的是范围，不是一句「连不上」——配置端口、偏移端口、窗口端口都在里面。
    for (const port of [8188, 8189, 8190, 8191, 8192, 8193, 8000]) {
      expect(line).toContain(`:${port}`);
    }
    expect(line).toContain("改「端口」");
  });

  it("同一批地址静默期内只写一条：运行期反复探测不再把面板刷满", async () => {
    respondOn([]);
    await resolveComfyBase();
    await resolveComfyBase();
    await resolveComfyBase();
    const hits = vi
      .mocked(logger.warn)
      .mock.calls.filter(([m]) => String(m).includes("Cannot reach ComfyUI"));
    expect(hits).toHaveLength(1);
  });

  it("静默期过后重新允许写一条", async () => {
    respondOn([]);
    await resolveComfyBase();
    // 把时钟推过一个静默窗口（不必真等 60s）：届时应当重新留下一条现场。
    const later = Date.now() + COMFY_PROBE_LOG_REPEAT_MS + 1;
    vi.spyOn(Date, "now").mockReturnValue(later);
    await resolveComfyBase();
    const hits = vi
      .mocked(logger.warn)
      .mock.calls.filter(([m]) => String(m).includes("Cannot reach ComfyUI"));
    expect(hits).toHaveLength(2);
  });

  it("命中窗口端口 8000 时记 warn 并说明是窗口地址回落", async () => {
    // Comfy Desktop 同机常驻窗口端口，配置的实例没起来时探测会落到它上面。
    respondOn([8000]);
    await expect(resolveComfyBase()).resolves.toBe("http://127.0.0.1:8000");
    expect(warned(/window at :8000/)).toBe(true);
  });
});
