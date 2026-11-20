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
vi.mock("~/lib/core/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import {
  ComfyViewError,
  freeComfyMemory,
  getHistory,
  getView,
  resolveComfyBase,
  probeComfyBase,
  resetComfyBase,
  resetProbeMissLog,
  resetStartingLog,
  startingLogAction,
  COMFY_PROBE_LOG_REPEAT_MS,
  COMFY_STARTING_PROGRESS_MS,
} from "./client";
import { getSettingsSync } from "../app-settings/app-settings.server";
import { findPidForMainPyDetailed, findPidListeningPort } from "./proc-detect";
import { resolveComfyLaunchPlan } from "./launch-path";
import { resetSweepNegativeForTests } from "./sweep-negative-cache";
import { logger } from "~/lib/core/logger";

const plan = {
  cmd: String.raw`D:\Comfy\ComfyUI\.venv\Scripts\python.exe`,
  baseArgs: ["-s", String.raw`D:\Comfy\ComfyUI\main.py`],
  cwd: String.raw`D:\Comfy\ComfyUI`,
  mainPy: String.raw`D:\Comfy\ComfyUI\main.py`,
};

/** 只让指定端口应答 `/system_stats`，其余连接一律拒绝。 */
function respondOn(ports: Array<number>) {
  return vi.spyOn(globalThis, "fetch").mockImplementation((input: unknown) => {
    const url = String(input);
    if (ports.some((p) => url.includes(`:${p}/`))) {
      return Promise.resolve(new Response("{}", { status: 200 }));
    }
    throw new Error("ECONNREFUSED");
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  resetComfyBase();
  resetProbeMissLog();
  resetStartingLog();
  /* 进程表「查无实例」的黏滞是跨用例的 globalThis 状态（与上面三个 reset 同族）：
   * 前一个用例的「全部落空」不该吃掉后一个用例的扫描断言（ISSUE #4195）。 */
  resetSweepNegativeForTests();
  vi.mocked(getSettingsSync).mockReturnValue({
    autoSyncLocalWorkflow: false,
    comfyCliPython: "",
    comfyuiAutoStart: true,
    comfyuiExtraArgs: "",
    comfyuiPath: String.raw`D:\Comfy`,
    comfyuiPort: 8188,
    exitKillComfyui: false,
    exitKillOllama: true,
    loginRequired: false,
  });
  vi.mocked(resolveComfyLaunchPlan).mockReturnValue(plan);
  vi.mocked(findPidForMainPyDetailed).mockResolvedValue({
    pid: null,
    failed: false,
  });
  vi.mocked(findPidListeningPort).mockResolvedValue(null);
});

afterEach(() => {
  resetComfyBase();
  resetProbeMissLog();
  resetStartingLog();
  vi.restoreAllMocks();
});

/** logger.warn 里有没有一条命中 `pattern` 的行。 */
function warned(pattern: RegExp): boolean {
  return vi.mocked(logger.warn).mock.calls.some(([msg]) => pattern.test(String(msg)));
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
    vi.mocked(findPidForMainPyDetailed).mockResolvedValue({
      pid: 100,
      failed: false,
    });
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

describe("getView — 取字节的地址组装与失败形状", () => {
  /** 让 `/api/view` 按 `reply` 应答，其余请求（端口探测等）统一回 200。
   *  顺手把打出去的查询串记进 `seen` —— 断言取这里，而不是回读 `mock.calls`
   *  （那个元素的类型是 `URL | RequestInfo` 联合，字符串化会撞上
   *  `no-base-to-string`；`input: unknown` 的写法与本文件顶部的 `respondOn` 一致）。 */
  function viewReply(reply: { bytes?: Array<number>; status: number }) {
    const seen: Array<string> = [];
    vi.spyOn(globalThis, "fetch").mockImplementation((input: unknown) => {
      const url = new URL(String(input));
      if (url.pathname !== "/api/view") {
        return Promise.resolve(new Response("{}", { status: 200 }));
      }
      seen.push(url.search);
      if (reply.status !== 200) {
        return Promise.resolve(new Response("nope", { status: reply.status }));
      }
      return Promise.resolve(
        new Response(new Uint8Array(reply.bytes ?? [1, 2, 3]), {
          status: 200,
        }),
      );
    });
    return seen;
  }

  it("三个参数都进查询串，字节原样交回（代理层不许自己猜默认值）", async () => {
    const seen = viewReply({ bytes: [9, 8, 7], status: 200 });
    const buf = await getView("shot_001.png", "canvas/sub", "output");
    expect([...buf]).toEqual([9, 8, 7]);
    const requested = new URL(`http://127.0.0.1:8188/api/view${seen[0]!}`);
    expect(requested.searchParams.get("filename")).toBe("shot_001.png");
    expect(requested.searchParams.get("subfolder")).toBe("canvas/sub");
    expect(requested.searchParams.get("type")).toBe("output");
  });

  it("上游非 2xx 时抛带状态码的 ComfyViewError —— 调用方分相靠这个字段，不靠读消息", async () => {
    viewReply({ status: 404 });
    const err = await getView("gone.png", "", "input").catch((error: unknown) => error);
    expect(err).toBeInstanceOf(ComfyViewError);
    if (!(err instanceof ComfyViewError)) {
      throw new Error("getView 未按预期抛出 ComfyViewError");
    }
    expect(err.status).toBe(404);
    // 消息保持原样：`executor-finalize` 那类只判「拿不到就抛」的调用方零感知
    expect(err.message).toBe("getView failed: 404");
  });

  it("连不上时不包成 ComfyViewError（那是「上游答了」的形状），原样把 fetch 的失败交出去", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("fetch failed"));
    await expect(getView("a.png", "", "input")).rejects.toBeInstanceOf(TypeError);
  });
});

describe("getHistory — promptId 只作为单个路径段拼接", () => {
  it("`../` 与 `?` 被编码，不能改写请求路径（CodeQL #12）", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("{}", { status: 200 }));
    await getHistory("../../system_stats?x=1");
    const calledUrl = fetchSpy.mock.calls[0]?.[0];
    if (typeof calledUrl !== "string") {
      throw new Error("fetch 的输入不是字符串 URL");
    }
    expect(calledUrl).toContain("/api/history/..%2F..%2Fsystem_stats%3Fx%3D1");
    /* 裸拼的两个症状都要消失：路径穿越与查询串注入。 */
    expect(calledUrl).not.toContain("../");
    expect(calledUrl).not.toContain("?x=1");
  });
});

describe("startingLogAction —— 启动中日志的场次聚合判据（ISSUE #4149）", () => {
  const T0 = 1_000_000;

  it("同一场次：首拍 first、窗口内 silent、30s 后 progress（elapsed 是累计等待）", () => {
    expect(startingLogAction(777, T0)).toEqual({ kind: "first", elapsedMs: 0 });
    /* 每 2s 一拍的连续轮询：全部静默（这是刷屏的现场——逐拍都还没就绪）。 */
    expect(startingLogAction(777, T0 + 2000)).toEqual({ kind: "silent" });
    expect(startingLogAction(777, T0 + 29_000)).toEqual({ kind: "silent" });
    /* 越过聚合窗口：一条进度行，带累计等待时长。 */
    expect(startingLogAction(777, T0 + 30_000)).toEqual({
      kind: "progress",
      elapsedMs: 30_000,
    });
    /* 进度行之后窗口重新起算。 */
    expect(startingLogAction(777, T0 + 32_000)).toEqual({ kind: "silent" });
    expect(startingLogAction(777, T0 + 61_000)).toEqual({
      kind: "progress",
      elapsedMs: 61_000,
    });
  });

  it("pid 变了（换实例 / 查询不到时 null）⇒ 新场次，重新从首条开始", () => {
    expect(startingLogAction(777, T0)).toEqual({ kind: "first", elapsedMs: 0 });
    expect(startingLogAction(777, T0 + 1000)).toEqual({ kind: "silent" });
    expect(startingLogAction(888, T0 + 2000)).toEqual({ kind: "first", elapsedMs: 0 });
  });

  it(`resetStartingLog 清零后重新 first（聚合窗口 = ${COMFY_STARTING_PROGRESS_MS}ms）`, () => {
    expect(startingLogAction(777, T0)).toEqual({ kind: "first", elapsedMs: 0 });
    expect(startingLogAction(777, T0 + 1000)).toEqual({ kind: "silent" });
    resetStartingLog();
    expect(startingLogAction(777, T0 + 2000)).toEqual({ kind: "first", elapsedMs: 0 });
  });
});

describe("resolveComfyBase —— 启动中日志的逐拍聚合（ISSUE #4149）", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** found.running（pid 在、端口未绑定）的轮询现场。 */
  const mockStarting = (pid: number | null): void => {
    vi.mocked(findPidForMainPyDetailed).mockResolvedValue({ pid, failed: false });
    vi.mocked(findPidListeningPort).mockResolvedValue(null);
    respondOn([]);
  };

  it("70s 等待窗口里逐拍轮询（2s/拍）只写 3 行：1 条首行 + 2 条进度行", async () => {
    mockStarting(777);
    let nowMs = 1_000_000;
    const dateSpy = vi.spyOn(Date, "now").mockImplementation(() => nowMs);
    try {
      for (let tick = 0; tick < 35; tick += 1) {
        // oxlint-disable-next-line no-await-in-loop -- 逐拍轮询的语义就是串行推进时钟；并行化会让拍序错乱
        await resolveComfyBase();
        nowMs += 2000;
      }
    } finally {
      dateSpy.mockRestore();
    }
    const infos = vi.mocked(logger.info).mock.calls.map(([msg]) => String(msg));
    const starting = infos.filter((m) => m.includes("starting, port not bound yet"));
    const progress = infos.filter((m) => m.includes("仍未绑定端口"));
    expect(starting, "首行文本不变（照发一次）").toHaveLength(1);
    expect(progress, "每 30s 一条进度行：30s 与 60s 各一条").toHaveLength(2);
    expect(progress[0]).toContain("已等待 30s");
    expect(progress[1]).toContain("已等待 60s");
  });

  it("端口绑定后场次清零：下一次启动重新从首条开始", async () => {
    let nowMs = 2_000_000;
    const dateSpy = vi.spyOn(Date, "now").mockImplementation(() => nowMs);
    try {
      mockStarting(777);
      await resolveComfyBase(); // 首条
      nowMs += 2000;
      await resolveComfyBase(); // silent
      /* 实例就绪：监听端口出现在进程表上。 */
      vi.mocked(findPidListeningPort).mockResolvedValue(8188);
      respondOn([8188]);
      await resolveComfyBase(); // Connected（终态）
      expect(
        vi
          .mocked(logger.info)
          .mock.calls.some(([msg]) => String(msg).includes("Connected to configured instance")),
      ).toBe(true);
      /* 下一轮启动（又是端口未绑定）：必须重新写首条，而不是被上一场次的
       * 状态顶成 silent。粘性缓存先清（生产里由 WS 断开时的 resetComfyBase
       * 触发，见 executor-ws）——否则 resolveComfyBase 直接命中缓存返回，
       * 根本走不进未绑定分支。 */
      resetComfyBase();
      mockStarting(777);
      respondOn([]);
      await resolveComfyBase();
    } finally {
      dateSpy.mockRestore();
    }
    const starting = vi
      .mocked(logger.info)
      .mock.calls.filter(([msg]) => String(msg).includes("starting, port not bound yet"));
    expect(starting, "两场启动各写一条首行").toHaveLength(2);
  });
});

// ── freeComfyMemory — 卸载模型两档（ISSUE #4637）──────────────────────────
// 端点在**根路径** `/free`（与 /system_stats / /queue 同族，不在 /api/ 下）；
// 两档力度 = free_memory 开关；失败返回 {ok:false, detail} 信封不抛错。
describe("freeComfyMemory — POST /free 的地址、载荷与失败信封", () => {
  /** RequestInit 的形状守卫（no-unsafe-type-assertion 禁 `as` 硬断言，收口用谓词）。 */
  function isRequestInit(value: unknown): value is RequestInit {
    return typeof value === "object" && value !== null && "method" in value && "body" in value;
  }

  /** 取 spy 收到的**发往 /free** 的那一笔（resolveComfyBase 先发的 /system_stats
   *  探测也在同一只 spy 里，按 URL 挑出目标请求），并把 init / body 收窄成
   *  可断言的形状。 */
  function freeCall(spy: { mock: { calls: Array<Array<unknown>> } }): {
    body: string;
    init: RequestInit;
    url: string;
  } {
    const call = spy.mock.calls.find((entry) => String(entry[0]).endsWith("/free"));
    if (call === undefined || !isRequestInit(call[1])) {
      throw new Error("应发出一笔带 RequestInit 的 POST /free");
    }
    const init = call[1];
    if (typeof init.body !== "string") {
      throw new Error("/free 的 body 应是 JSON 字符串");
    }
    return { body: init.body, init, url: String(call[0]) };
  }

  it("卸载模型：POST 根路径 /free，body 带 unload_models=true / free_memory=false", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("{}", { status: 200 }));
    const r = await freeComfyMemory({ unloadModels: true, freeMemory: false });
    expect(r).toMatchObject({ ok: true, detail: "已卸载模型" });
    const call = freeCall(fetchSpy);
    expect(call.url).toBe("http://127.0.0.1:8188/free");
    expect(call.init.method).toBe("POST");
    expect(JSON.parse(call.body)).toEqual({
      unload_models: true,
      free_memory: false,
    });
  });

  it("卸载模型和执行缓存：free_memory=true，成功文案带「执行缓存」", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("{}", { status: 200 }));
    const r = await freeComfyMemory({ unloadModels: true, freeMemory: true });
    expect(r).toMatchObject({ ok: true, detail: "已卸载模型并释放执行缓存" });
    const call = freeCall(fetchSpy);
    expect(JSON.parse(call.body)).toEqual({
      unload_models: true,
      free_memory: true,
    });
  });

  it("非 2xx：ok=false 且带状态码，不抛错", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("nope", { status: 503 }));
    const r = await freeComfyMemory({ unloadModels: true, freeMemory: false });
    expect(r.ok).toBe(false);
    expect(r.detail).toContain("503");
  });

  it("连不上（ECONNREFUSED）：ok=false 且带原因，不抛错", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("ECONNREFUSED"));
    const r = await freeComfyMemory({ unloadModels: true, freeMemory: true });
    expect(r.ok).toBe(false);
    expect(r.detail).toContain("ECONNREFUSED");
  });
});
