// 设置页逻辑层单测：hook 走真实 tRPC React 客户端，经 MSW 转发到可控测试 router，断言
// 编排行为（草稿播种与重播、Ollama 探测时机、按任务温度合并、失败走 flash、openExternalUrl）。
// 自 ISSUE #1900 起 ComfyUI 运行态用例搬去
// `src/components/studio/comfyui/hooks/use-comfyui-control.test.ts`。

import { createElement, type ReactNode } from "react";
import { act, cleanup, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchStreamLink } from "@trpc/client";
import { TRPCError } from "@trpc/server";
import { http, HttpResponse } from "msw/http";
import SuperJSON from "superjson";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createTestQueryClient } from "../../../../../tests/helpers/renderWithProviders";
import { createTestTRPC, testTrpcEndpoint } from "../../../../../tests/helpers/test-trpc";
import { setupTrpcServer } from "../../../../../tests/helpers/trpc-msw";
import { TRPCProvider, createTrpcClient } from "~/trpc/react";
import { resetComfyStateClientForTest } from "~/lib/comfy/comfy-state-client";
import { getComfyStateChange, resetComfyStateWatchForTest } from "~/lib/comfyui/state-watch";
import { probeOllama, startOllama } from "~/lib/llm/ollama-client";

import { useSettingsPage, type LlmConfig, type Settings } from "./use-settings-page";

vi.mock("~/lib/llm/ollama-client", () => ({
  probeOllama: vi.fn(),
  startOllama: vi.fn(),
}));

/* 桌面壳探测：默认 true（壳内），让「打开查看 → 内嵌页签」那组用例继续走原路径。
 * 浏览器形态用例（新浏览器页签）在 beforeEach 里把它翻成 false。 */
const { isDesktopShellMock } = vi.hoisted(() => {
  const impl: () => boolean = () => true;
  return { isDesktopShellMock: vi.fn(impl) };
});
vi.mock("~/lib/shell/desktop-shell-client", () => ({
  isDesktopShell: isDesktopShellMock,
}));

// 客户端逻辑层现经 `postAppRuntimeLog`（走 `/api/logs/app-runtime`）把失败补记到
// app-runtime 日志，不再直接 import Node-only 的 `app-runtime-log`（ISSUE #282）。测试保留
// `fetchFileLogSlice` 真实实现（经 MSW 返回日志），只 spy `postAppRuntimeLog` 并记录调用参数；
// `runtimeLogCalls` 须用 vi.hoisted 定义，供工厂在提升后引用。
const { postAppRuntimeLogMock, runtimeLogCalls, sessionLogRequests } = vi.hoisted(() => {
  const calls: Array<{
    fields?: unknown;
    level: string;
    msg: string;
    ns: string;
  }> = [];
  /** 启动日志「按会话取」的请求记账（来源 + 请求的会话 id） */
  const logRequests: Array<{ session: string | null; source: string }> = [];
  return {
    postAppRuntimeLogMock: vi.fn(
      (ns: string, level: string, msg: string, fields?: unknown): Promise<void> => {
        calls.push({ ns, level, msg, fields });
        return Promise.resolve();
      },
    ),
    runtimeLogCalls: calls,
    sessionLogRequests: logRequests,
  };
});
vi.mock("~/lib/log/log-file-client", () => {
  // fetchFileLogSlice / fetchLogSessions 复刻真实实现（走全局 fetch，由 MSW 拦截
  // 返回日志内容）。之所以不引用 importOriginal：真实实现只是对端点的一次 fetch，
  // 这里等价转发，避免 vitest 别名解析与模块类型在工厂内部的告警。
  const fetchFileLogSlice = vi.fn(
    async (
      source: string,
      offset: number,
    ): Promise<{ content: string; offset: number; size: number } | null> => {
      const res = await fetch(`/api/logs/current?source=${source}&offset=${offset}`);
      if (!res.ok) {
        return null;
      }
      const body: unknown = await res.json();
      if (!isFileLogSlice(body)) {
        throw new Error("fetchFileLogSlice 的响应体不是 { content, offset, size }");
      }
      return body;
    },
  );
  const fetchLogSessions = vi.fn(async (source: string, sessionId?: string) => {
    sessionLogRequests.push({ source, session: sessionId ?? null });
    const query = new URLSearchParams({ source });
    if (sessionId !== undefined && sessionId !== "") {
      query.set("session", sessionId);
    }
    const res = await fetch(`/api/logs/sessions?${query.toString()}`);
    if (!res.ok) {
      return null;
    }
    /* SAFETY: 类型断言已复核 */
    return (await res.json()) as unknown;
  });
  return {
    fetchFileLogSlice,
    fetchLogSessions,
    postAppRuntimeLog: postAppRuntimeLogMock,
  };
});

/** 运行时收窄：只认非 null 的普通对象（数组不算记录）。 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** `/api/logs/current` 的切片响应；形状不对就让用例直接失败。 */
type FileLogSlice = { content: string; offset: number; size: number };

function isFileLogSlice(value: unknown): value is FileLogSlice {
  return (
    isRecord(value) &&
    typeof value.content === "string" &&
    typeof value.offset === "number" &&
    typeof value.size === "number"
  );
}

/** `postAppRuntimeLog` 的记账条目：level/msg 必须是字符串，fields 若给必须是对象。 */
type RuntimeLogCall = { fields?: unknown; level: string; msg: string };

function isRuntimeLogCall(value: unknown): value is RuntimeLogCall {
  return (
    isRecord(value) &&
    typeof value.level === "string" &&
    typeof value.msg === "string" &&
    (value.fields === undefined || isRecord(value.fields))
  );
}

/** 把记账数组当 `unknown` 逐层收窄；形状不对就让用例失败（与原来断言后崩同一判定）。 */
function readRuntimeLogCalls(): RuntimeLogCall[] {
  const raw: unknown = runtimeLogCalls;
  if (!Array.isArray(raw)) {
    throw new Error("runtimeLogCalls 不是数组");
  }
  const entries = raw.filter(isRuntimeLogCall);
  if (entries.length !== raw.length) {
    throw new Error("runtimeLogCalls 含非日志条目");
  }
  return entries;
}

const probeMock = vi.mocked(probeOllama);
const startMock = vi.mocked(startOllama);

const SETTINGS: Settings = {
  comfyuiPath: "D:/ComfyUI",
  comfyuiExtraArgs: "",
  comfyCliPython: "",
  comfyuiAutoStart: true,
  comfyuiPort: 0,
  exitKillComfyui: true,
  exitKillOllama: true,
  autoSyncLocalWorkflow: false,
};

const LLM: LlmConfig = {
  provider: "local",
  baseUrl: "http://localhost:11434/v1",
  model: "qwen3:14b",
  localCandidates: [],
  extraModels: [],
  temperature: 0.7,
  maxTokens: 2048,
  apiKey: null,
};

type Behavior = {
  /** comfyui.status 返回的 base（非空即「运行中」，供「打开查看」使用）。 */
  comfyBase?: string | null;
  comfyInstance?: {
    desktopManaged: boolean;
    instanceType: "desktop" | "portable" | "venv" | null;
    pathConfigured: boolean;
  };
  comfyStatusPending?: boolean;
  dbStudioStatusError?: string;
  dbStudioUp?: boolean;
  llm?: LlmConfig;
  llmError?: string;
  saveLlmError?: string;
  saveSettingsError?: string;
  settings?: Settings;
  /** setting.get 失败时抛出的文案（模拟服务端报错）。 */
  settingsError?: string;
};

/** 永不 settle 的 promise：让某个端点「一直不返回」。
 *  写 `() => undefined` 而不是 `() => {}`：后者会被 eslint 的 no-empty-function 拦下。 */
const neverSettle = (): Promise<void> => new Promise<void>(() => undefined);

let behavior: Behavior = {};
/* 「运行态变了」长轮询通道（`?since=…`）的请求记账：通道不再由设置页订阅（运行态搬去
 * 侧栏「ComfyUI」页，ISSUE #1900），记账是「没有第二个消费方」的现场证据（见下方
 * 「设置页不再订阅运行态通道」用例）。 */
const stateRequests: Array<string> = [];
/* `comfyStatus` 端点的调用次数：设置页一次都不该调到它（见对应用例）。 */
let comfyStatusCalls = 0;

const t = createTestTRPC();
const mockRouter = t.router({
  setting: t.router({
    get: t.procedure.query(() => {
      if (behavior.settingsError !== undefined && behavior.settingsError !== "") {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: behavior.settingsError,
        });
      }
      return { settings: behavior.settings ?? SETTINGS };
    }),
    save: t.procedure.mutation(() => {
      if (behavior.saveSettingsError !== undefined && behavior.saveSettingsError !== "") {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: behavior.saveSettingsError,
        });
      }
      return { settings: behavior.settings ?? SETTINGS };
    }),
    /* 运行态端点：设置页**不再调用它**（归侧栏「ComfyUI」页）。这里仍然留着，
     * 因为它恰好是那条判据的反面 —— 它一次都不该被请求到（见
     * 「设置页不再订阅运行态通道」）。没 handler 会让用例以 unhandled frame 报错，
     * 那是**假红**（判据被环境吃掉），所以留一个必定计数的桩。 */
    comfyStatus: t.procedure.query(async () => {
      comfyStatusCalls += 1;
      if (behavior.comfyStatusPending === true) {
        await neverSettle();
      }
      return {
        up: behavior.comfyBase !== null && behavior.comfyBase !== undefined,
        base: behavior.comfyBase ?? null,
        starting: false,
      };
    }),
    /* 安装形态与运行态**分开取**（fs-only，与首屏配置同批）：这里给一份便携版默认。
     * 用例不关心形态时不必改它；要断言徽标文案就按需覆写这三个字段。 */
    comfyInstance: t.procedure.query(
      () =>
        behavior.comfyInstance ?? {
          pathConfigured: true,
          /* SAFETY: 类型断言已复核 */
          instanceType: "portable" as const,
          desktopManaged: false,
        },
    ),
    /* Drizzle Studio：分区拉起的 status 查询与动作，均需有 mock handler，
     * 否则 onUnhandledFrame:error 会让渲染整个 hook 的用例全挂 */
    dbStudioStatus: t.procedure.query(() => {
      if (behavior.dbStudioStatusError !== undefined && behavior.dbStudioStatusError !== "") {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: behavior.dbStudioStatusError,
        });
      }
      return {
        up: behavior.dbStudioUp ?? false,
        starting: false,
        port: 4983,
      };
    }),
    dbStudioStart: t.procedure.mutation(() => ({
      ok: true,
      detail: "已启动",
    })),
    dbStudioStop: t.procedure.mutation(() => ({
      ok: true,
      detail: "已关闭",
    })),
    dbStudioOpen: t.procedure.mutation(() => ({
      ok: true,
      detail: "已打开",
    })),
    openExternal: t.procedure.mutation(() => ({
      ok: true,
      detail: "已用系统默认浏览器打开",
    })),
  }),
  llm: t.router({
    configGet: t.procedure.query(() => {
      if (behavior.llmError !== undefined && behavior.llmError !== "") {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: behavior.llmError,
        });
      }
      return { config: behavior.llm ?? LLM };
    }),
    configSave: t.procedure.mutation(() => {
      if (behavior.saveLlmError !== undefined && behavior.saveLlmError !== "") {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: behavior.saveLlmError,
        });
      }
      return { config: behavior.llm ?? LLM };
    }),
  }),
});

const server = setupTrpcServer(mockRouter);

function makeWrapper(queryClient?: QueryClient) {
  const qc = queryClient ?? createTestQueryClient();
  const client = createTrpcClient({
    links: [
      httpBatchStreamLink({
        transformer: SuperJSON,
        url: testTrpcEndpoint(),
      }),
    ],
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(
      QueryClientProvider,
      { client: qc },
      createElement(TRPCProvider, {
        trpcClient: client,
        queryClient: qc,
        // oxlint-disable-next-line react/no-children-prop -- createElement 的第三参即 children
        children,
      }),
    );
  };
}

beforeAll(() => {
  server.listen({ onUnhandledFrame: "error" });
});
beforeEach(() => {
  runtimeLogCalls.length = 0;
  sessionLogRequests.length = 0;
  comfyStatusCalls = 0;
  stateRequests.length = 0;
  /* 客户端那条长轮询链与「已见 seq」都挂在 `globalThis` 上（HMR 单例）：不清
   * 会让上一个用例的订阅与 seq 带进来 —— 表现是这一条用例压根不订阅（链还在），
   * 或第一条变化被当成「见过」而不派发。 */
  resetComfyStateClientForTest();
  resetComfyStateWatchForTest();
  /* 兜底缓存（sessionStorage 快照）跨用例共享同一个 jsdom —— 不清会把上一个
   * 用例的成功配置带进来，让「无兜底 → 整页降级」的用例失去意义。 */
  sessionStorage.clear();
  /* 默认「Ollama 运行中」：不设默认值时 vi.fn() 返回 undefined，探测回调会在
   * 上一个用例卸载后跑到，产生「Cannot read properties of undefined」的
   * unhandled rejection（表现为用例绿但文件红）。 */
  probeMock.mockResolvedValue({ up: true, models: [] });
  startMock.mockResolvedValue(undefined);
  /* /api/logs/sessions 默认 handler：设置页挂载就会为三段「启动日志」各取一次
   * 会话 + 正文，没有 handler 会以 onUnhandledFrame:error 报 unhandled
   * rejection（与上面 probeMock 同源问题）。各用例按需覆盖。 */
  server.use(
    http.get("*/api/logs/sessions", () =>
      HttpResponse.json({
        sessions: [],
        selectedId: null,
        content: "",
        truncated: false,
        windowed: false,
        size: 0,
      }),
    ),
    /* 「运行态变了」那条长轮询通道。设置页自 ISSUE #1900 起**不再订阅**它
     * （运行态整块搬去了侧栏「ComfyUI」页）—— 这里留 handler 是为了让
     * 「一次都没连过来」这条判据落在**正常应答**上，而不是被
     * `onUnhandledFrame: error` 的 unhandled 报错冒充。 */
    http.get("*/api/comfy/state", ({ request }) => {
      stateRequests.push(new URL(request.url).search);
      /* 与真实路由同一判决：`since` 比当前纪元旧 → 回那一次变化，否则 204。 */
      const change = getComfyStateChange();
      const since = Number.parseInt(new URL(request.url).searchParams.get("since") ?? "0", 10);
      if (change.last === null || change.seq <= since) {
        return new HttpResponse(null, { status: 204 });
      }
      return HttpResponse.json(change.last);
    }),
  );
});
afterEach(() => {
  cleanup();
  behavior = {};
  comfyStatusCalls = 0;
  server.resetHandlers();
});
afterAll(() => {
  server.close();
});

describe("useSettingsPage", () => {
  it("草稿从查询结果播种，两份齐了才算 ready", async () => {
    const { result } = renderHook(() => useSettingsPage(), {
      wrapper: makeWrapper(),
    });

    await expect.poll(() => result.current.drafts).not.toBeNull();
    expect(result.current.drafts?.llm.model).toBe("qwen3:14b");
    expect(result.current.drafts?.settings.comfyuiPath).toBe("D:/ComfyUI");
  });

  /* 跳转落点：载荷带目标分区时 hook 直接停在它上面并登记 `pendingJump` 交外壳去滚。
   * 载荷不在挂载时消费（首帧通常在 loading，消费掉会丢目标，现场：左侧停在第一项），
   * 外壳真的滚过去调 `ackJumpSection` 才算落定。 */
  it("带 initialSection 跳进来：停在目标分区并登记待落定目标，消费等外壳回调", () => {
    const onConsume = vi.fn();
    const { result } = renderHook(
      () =>
        useSettingsPage({
          initialSection: "comfyui",
          onConsumeInitialSection: onConsume,
        }),
      { wrapper: makeWrapper() },
    );
    expect(result.current.section).toBe("comfyui");
    expect(result.current.pendingJump).toBe("comfyui");
    expect(onConsume).not.toHaveBeenCalled();

    act(() => {
      result.current.ackJumpSection();
    });
    expect(result.current.pendingJump).toBeNull();
    expect(onConsume).toHaveBeenCalled();
  });

  /* 载荷是字符串（来自 `src/lib`，不得反向依赖视图层），合法性由这里按
   * `SETTINGS_SECTIONS` 收敛：不在白名单里就当没给，仍落默认分区、也不登记目标。 */
  it("非法 initialSection 被收敛掉：仍落默认分区，且不登记跳转目标", () => {
    const onConsume = vi.fn();
    const { result } = renderHook(
      () =>
        useSettingsPage({
          initialSection: "not-a-section",
          onConsumeInitialSection: onConsume,
        }),
      { wrapper: makeWrapper() },
    );
    expect(result.current.section).toBe("llmLocal");
    expect(result.current.pendingJump).toBeNull();
    expect(onConsume).not.toHaveBeenCalled();
  });

  /* 回归 ISSUE #59：设置界面「打开 → 关闭 → 再打开」会显示「配置数据未就绪」。
   * 根因：播种只比对「数据引用是否变化」，关闭再打开时 QueryClient 命中缓存，
   * 挂载首帧 llmConfig/settingsData 即就绪，prev 初值被缓存命中 → 分支永不触发，
   * 草稿一直为空 → 容器落到降级 UI。这里在同一（带缓存的）QueryClient 上先挂载、
   * 卸载、再挂载，验证第二次挂载后草稿仍会播种而非落空。 */
  it("关闭再打开命中缓存后，草稿仍会被播种（不落到未就绪降级）", async () => {
    const qc = new QueryClient({
      defaultOptions: {
        queries: { retry: false, staleTime: 0, gcTime: 60_000 },
        mutations: { retry: false },
      },
    });
    // 第一次打开：查询完成并播种
    const first = renderHook(() => useSettingsPage(), {
      wrapper: makeWrapper(qc),
    });
    await expect.poll(() => first.result.current.drafts).not.toBeNull();
    // 关闭（卸载），缓存保留
    first.unmount();

    // 再打开：QueryClient 仍在，query 命中缓存，首帧即就绪
    const second = renderHook(() => useSettingsPage(), {
      wrapper: makeWrapper(qc),
    });
    await expect.poll(() => second.result.current.drafts).not.toBeNull();
    expect(second.result.current.drafts?.llm.model).toBe("qwen3:14b");
    expect(second.result.current.drafts?.settings.comfyuiPath).toBe("D:/ComfyUI");
    // 不该进入降级/加载兜底
    expect(second.result.current.isInitialLoad).toBe(false);
    expect(second.result.current.hasError).toBe(false);
  });

  it("本地 provider 时探测 Ollama；切到远端后不再探测", async () => {
    probeMock.mockResolvedValue({
      up: true,
      models: [{ name: "qwen3:14b", size: 1, modified_at: "" }],
    });
    const { result } = renderHook(() => useSettingsPage(), {
      wrapper: makeWrapper(),
    });
    await expect.poll(() => result.current.drafts).not.toBeNull();
    await expect.poll(() => result.current.ollamaStatus).toBe("up");
    expect(result.current.ollamaModels).toHaveLength(1);
    expect(probeMock).toHaveBeenCalledWith("http://localhost:11434/v1");

    const callsAfterLocalProbe = probeMock.mock.calls.length;
    act(() => {
      result.current.patchLlm({ provider: "remote" });
    });
    /* 探测是 setTimeout(…, 0) 里触发的，切到远端后要等一个宏任务再断言，
     * 确认没有新的探测被排进去。 */
    await act(async () => {
      // sleep-ok: 等宏任务排空：探测是 setTimeout(0) 里触发的，这里确认切换后没有新的探测被排进去。
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(probeMock).toHaveBeenCalledTimes(callsAfterLocalProbe);
  });

  /* 回归 ISSUE #99：保存的 provider 是 remote（或没填 baseUrl）时，本地模型页
   * 没有任何可探测的 Ollama —— 若状态停留在初始的 checking，状态行会一直
   * 「检测 Ollama 服务…」转圈永不结束。这里断言它会落定为 down 而非卡住。 */
  it("provider 为远端时不会停在 checking，状态落定为 down", async () => {
    behavior.llm = { ...LLM, provider: "remote" };
    const { result } = renderHook(() => useSettingsPage(), {
      wrapper: makeWrapper(),
    });
    const baseline = probeMock.mock.calls.length;
    await expect.poll(() => result.current.drafts).not.toBeNull();
    await expect.poll(() => result.current.ollamaStatus).toBe("down");
    // 远端 provider 不该触发本地 Ollama 探测
    expect(probeMock).toHaveBeenCalledTimes(baseline);
  });

  it("Ollama 探测失败 → down；启动后轮询到就绪才恢复 up", async () => {
    /* 前 2 次探测 down（初始 + 启动后第 1 轮），第 3 次起 up——
     * 模拟 ollama serve 冷启动期间端口未就绪、稍后才接上。 */
    probeMock
      .mockResolvedValueOnce({ up: false })
      .mockResolvedValueOnce({ up: false })
      .mockResolvedValue({ up: true, models: [] });
    /* 一个用例一把时钟，且换时钟必须在挂载之前（规范 11 §11.14）：否则挂载链还挂在
     * 真实时钟上，一旦越过 testTimeout，被抛下的 continuation 落进下一条用例的假时钟
     * 窗口，症状成对出现（先超时红，再 `Timer APIs are not mocked`）。 */
    vi.useFakeTimers();
    try {
      const { result } = renderHook(() => useSettingsPage(), {
        wrapper: makeWrapper(),
      });
      /* 挂载链在假时钟上跑到落定：首探排在 `setTimeout(…, 0)`，推进 1s 一定跨过它，
       * 而这一秒是**虚拟的**（不占墙钟预算）。 */
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });
      expect(result.current.ollamaStatus).toBe("down");
      expect(result.current.ollamaStarting).toBe(false);

      let starting: Promise<void> = Promise.resolve();
      act(() => {
        starting = result.current.startOllama();
      });
      // 推进轮询的 2s 间隔定时器直到探测到 up（第三轮探测）
      await vi.advanceTimersByTimeAsync(10_000);
      await act(async () => {
        await starting;
      });
      expect(startMock).toHaveBeenCalledOnce();
      expect(result.current.ollamaStatus).toBe("up");
      expect(result.current.ollamaStarting).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("启动轮询期间状态行停在 starting，不被并发探测覆盖（防 UI 跳变）", async () => {
    /* 启动后前几轮探测都 down，模拟 ollama 冷启动窗口：轮询里探测失败
     * 不得把状态行打回「未运行」，也不得发「检测中」抢屏幕。 */
    probeMock.mockResolvedValue({ up: false });
    /* 同上一条：整条链只在假时钟上跑（挂载前就换时钟）。 */
    vi.useFakeTimers();
    try {
      const { result } = renderHook(() => useSettingsPage(), {
        wrapper: makeWrapper(),
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });
      expect(result.current.ollamaStatus).toBe("down");

      let starting: Promise<void> = Promise.resolve();
      act(() => {
        starting = result.current.startOllama();
      });
      expect(result.current.ollamaStatus).toBe("starting");

      // 推进两轮轮询（探测都 down），状态行必须保持 starting
      await vi.advanceTimersByTimeAsync(5000);
      expect(result.current.ollamaStatus).toBe("starting");
      expect(result.current.ollamaStarting).toBe(true);

      // 第 3 轮起探测 up → 状态行一次性落到 up
      probeMock.mockResolvedValue({ up: true, models: [] });
      await vi.advanceTimersByTimeAsync(5000);
      await act(async () => {
        await starting;
      });
      expect(result.current.ollamaStatus).toBe("up");
      expect(result.current.ollamaStarting).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  /* 回归 #273：设置加载失败只体现在降级 UI，不经过 console/unhandledrejection，
   * 日志面板里什么也没有。现在失败会主动落 app-runtime 错误日志（面板轮询可见）。 */
  it("查询失败时把错误落 app-runtime 日志且同一错误只记一次", async () => {
    behavior.llmError = "数据库被锁";
    runtimeLogCalls.length = 0;
    const { result } = renderHook(() => useSettingsPage(), {
      wrapper: makeWrapper(),
    });
    await expect.poll(() => readRuntimeLogCalls().some((c) => c.level === "error")).toBe(true);
    /* llm.configGet 失败、setting.get 成功 → 草稿仍为空（一份都不齐）。
     * 本次运行没有成功读过的配置 → 没有兜底可用，必须落整页降级 UI 拿到重试与
     * 日志出口，而不是 「配置数据未就绪」死角（见下方 ISSUE #304 的专项回归）。 */
    expect(result.current.drafts).toBeNull();
    expect(result.current.hasError).toBe(true);
    expect(result.current.serveState).toBeNull();
    expect(result.current.errorText).toContain("数据库被锁");
    const errors = readRuntimeLogCalls().filter((c) => c.level === "error");
    expect(errors.length).toBe(1);
    expect(errors[0]?.msg).toContain("数据库被锁");

    // 重试后失败不变 → 不重复记
    act(() => {
      result.current.retry();
    });
    const errorsAfter = readRuntimeLogCalls().filter((c) => c.level === "error");
    expect(errorsAfter.length).toBe(1);
  });

  /* 回归 ISSUE #304：setting.get 成功、llm.configGet 失败时，旧 hasError 判「两份数据
   * 都为空」不命中、isInitialLoad 也为假，用户落进「配置数据未就绪」死角（没有原因/重试/
   * 日志指引）。现 hasError = 任一查询失败且草稿未就绪 → 该边界落错误降级视图。 */
  it("一半查询失败且草稿未就绪 → 落错误视图而非「配置数据未就绪」死角", async () => {
    behavior.llmError = "no such table: llmConfig";
    const { result } = renderHook(() => useSettingsPage(), {
      wrapper: makeWrapper(),
    });
    await expect.poll(() => result.current.hasError).toBe(true);

    // setting.get 成功、llm.configGet 失败；本次运行没有读成过 → 无兜底
    expect(result.current.drafts).toBeNull();
    // 兜底文案不可达：既不是加载中，也不是「未就绪且没失败」
    expect(result.current.isInitialLoad).toBe(false);
    expect(result.current.notReady).toBe(false);
    // 错误视图有可读原因 + 重试出口
    expect(result.current.errorText).toContain("no such table: llmConfig");
    expect(typeof result.current.retry).toBe("function");
  });

  /* 回归 ISSUE #360：设置页「经常出现」的那类失败，其实只是**服务端一侧的读**
   * 偶发失败（应用服务重启窗口 / 数据库迁移中），而界面本来完全能用。
   *
   * 判据：只要这次会话里成功读到过配置（或上次运行留下了快照），失败就不该把整页
   * 换成错误视图 —— 用兜底草稿继续渲染，失败原因走非阻塞的 serveState 提示条。 */
  it("读取失败但有兜底草稿 → 正常渲染 + serveState 提示，不再整页降级", async () => {
    /* 先让一份查询成功读到配置（播种 lastGood 缓存）。 */
    const first = renderHook(() => useSettingsPage(), {
      wrapper: makeWrapper(),
    });
    await expect.poll(() => first.result.current.drafts).not.toBeNull();
    const cached = first.result.current.drafts;
    expect(cached).not.toBeNull();
    first.unmount();

    /* 缓存已写入 sessionStorage（跨整页刷新可用），但本次会话的内存 ref 已随
     * 卸载消失 —— 这正是「刷新后立刻遇到失败」的真实路径。 */
    behavior = { llmError: "no such table: llmConfig" };
    const second = renderHook(() => useSettingsPage(), {
      wrapper: makeWrapper(),
    });

    await expect.poll(() => second.result.current.drafts).not.toBeNull();
    // 界面可用：不是整页错误、也不是「未就绪」死角
    expect(second.result.current.hasError).toBe(false);
    expect(second.result.current.notReady).toBe(false);
    // 失败原因仍然可见（非阻塞提示条），且带重试出口
    expect(second.result.current.serveState?.errorText).toContain("no such table: llmConfig");
    expect(second.result.current.drafts?.settings.comfyuiPath).toBe("D:/ComfyUI");
    expect(typeof second.result.current.retry).toBe("function");
  });

  /* 回归 ISSUE #304：补记日志时把原始报错（tRPC code / 服务端原文 / 堆栈首行）
   * 一并落盘。此前只记翻译后的可读文案，服务端真实报错在面板里彻底丢失，
   * 拿着「请求被中断」的提示无从排查。 */
  it("补记 app-runtime 时带上原始报错（raw 字段）", async () => {
    behavior.llmError = "no such table: llmConfig";
    runtimeLogCalls.length = 0;
    const { result } = renderHook(() => useSettingsPage(), {
      wrapper: makeWrapper(),
    });
    await expect.poll(() => result.current.hasError).toBe(true);
    await expect.poll(() => readRuntimeLogCalls().some((c) => c.level === "error")).toBe(true);

    const entry = readRuntimeLogCalls().find((c) => c.level === "error");
    const fields = entry?.fields;
    if (!isRecord(fields)) {
      throw new Error("错误日志条目缺少 fields");
    }
    expect(fields.query).toBe("llm.configGet");
    // raw 是「给排查用」的原文，应含服务端报错本身
    expect(fields.raw).toContain("no such table: llmConfig");
  });

  /* 回归 ISSUE #304：两个查询同批失败时，日志字段要把**两个**查询名都记上，
   * 否则只看得到其中一条，另一条的失败在面板里无从对应。 */
  it("两个查询都失败时，日志字段记全两条查询名", async () => {
    behavior.llmError = "llm 炸了";
    behavior.settingsError = "settings 炸了";
    runtimeLogCalls.length = 0;
    const { result } = renderHook(() => useSettingsPage(), {
      wrapper: makeWrapper(),
    });
    await expect.poll(() => result.current.hasError).toBe(true);
    await expect.poll(() => readRuntimeLogCalls().some((c) => c.level === "error")).toBe(true);

    const entry = readRuntimeLogCalls().find((c) => c.level === "error");
    const fields = entry?.fields;
    if (!isRecord(fields)) {
      throw new Error("错误日志条目缺少 fields");
    }
    expect(fields.query).toContain("setting.get");
    expect(fields.query).toContain("llm.configGet");
  });

  it("startOllama 失败 → flash 出可读文案（失败路径必须有出口）", async () => {
    probeMock.mockResolvedValue({ up: false });
    startMock.mockRejectedValue(new Error("spawn ENOENT"));
    const { result } = renderHook(() => useSettingsPage(), {
      wrapper: makeWrapper(),
    });
    await expect.poll(() => result.current.drafts).not.toBeNull();

    await act(async () => {
      await result.current.startOllama();
    });
    expect(result.current.flash).toEqual({
      kind: "err",
      text: "spawn ENOENT",
    });
    expect(result.current.ollamaStarting).toBe(false);
  });

  it("按任务温度：写入覆盖值；清空输入则删掉该 key", async () => {
    const { result } = renderHook(() => useSettingsPage(), {
      wrapper: makeWrapper(),
    });
    await expect.poll(() => result.current.drafts).not.toBeNull();

    act(() => {
      result.current.setTaskTemperature("code", "0.1");
    });
    expect(result.current.drafts?.llm.temperatureByTask).toEqual({ code: 0.1 });

    act(() => {
      result.current.setTaskTemperature("chat", "0.9");
    });
    expect(result.current.drafts?.llm.temperatureByTask).toEqual({
      code: 0.1,
      chat: 0.9,
    });

    // 清空 = 删 key，而不是留下 undefined（否则「已覆盖」徽标一直亮）
    act(() => {
      result.current.setTaskTemperature("code", "");
    });
    expect(result.current.drafts?.llm.temperatureByTask).toEqual({ chat: 0.9 });

    // 最后一个也清空 → 整个 map 回到 undefined
    act(() => {
      result.current.setTaskTemperature("chat", "");
    });
    expect(result.current.drafts?.llm.temperatureByTask).toBeUndefined();
  });

  it("远端模型：添加/移除即时落库（重名/空名拒绝）；生效模型字段不受清单管理", async () => {
    const { result } = renderHook(() => useSettingsPage(), {
      wrapper: makeWrapper(),
    });
    await expect.poll(() => result.current.drafts).not.toBeNull();

    // 设置页只做配置：初始清单 = 候选条目（不含「当前模型」虚拟行）
    expect(result.current.remoteModelList.map((e) => e.name)).toEqual([]);

    let out: { error?: string; ok: boolean } = { ok: false };
    await act(async () => {
      out = await result.current.addRemoteModel({ name: "gpt-4o" });
    });
    expect(out.ok).toBe(true);
    expect(result.current.remoteModelList.map((e) => e.name)).toEqual(["gpt-4o"]);
    // 即时落库成功有提示条
    expect(result.current.flash).toEqual({
      kind: "ok",
      text: "LLM 配置已保存",
    });

    // 重名拒绝（候选）；空名拒绝 —— 校验失败不触发保存
    await act(async () => {
      out = await result.current.addRemoteModel({ name: " gpt-4o " });
    });
    expect(out.ok).toBe(false);
    await act(async () => {
      out = await result.current.addRemoteModel({ name: "   " });
    });
    expect(out.ok).toBe(false);

    // 与生效模型同名也可加入候选（「当前生效」概念已移出设置页）
    await act(async () => {
      out = await result.current.addRemoteModel({ name: "qwen3:14b" });
    });
    expect(out.ok).toBe(true);
    expect(result.current.remoteModelList.map((e) => e.name)).toEqual(["gpt-4o", "qwen3:14b"]);

    // 移除即时落库，只动清单不碰生效模型字段（运行时在工坊切换）
    await act(async () => {
      out = await result.current.removeRemoteModel("gpt-4o");
    });
    expect(out.ok).toBe(true);
    expect(result.current.remoteModelList.map((e) => e.name)).toEqual(["qwen3:14b"]);
    await act(async () => {
      out = await result.current.removeRemoteModel("qwen3:14b");
    });
    expect(out.ok).toBe(true);
    expect(result.current.remoteModelList.map((e) => e.name)).toEqual([]);
    /* 生效模型字段保留原值 —— 它归工坊运行时管理 */
    expect(result.current.drafts?.llm.model).toBe("qwen3:14b");
  });

  it("远端模型：落库失败 → ok:false + 错误提示条", async () => {
    behavior = { saveLlmError: "磁盘只读" };
    const { result } = renderHook(() => useSettingsPage(), {
      wrapper: makeWrapper(),
    });
    await expect.poll(() => result.current.drafts).not.toBeNull();

    let out: { error?: string; ok: boolean } = { ok: false };
    await act(async () => {
      out = await result.current.addRemoteModel({ name: "gpt-4o" });
    });
    expect(out.ok).toBe(false);
    expect(out.error).toBe("磁盘只读");
    expect(result.current.flash).toEqual({ kind: "err", text: "磁盘只读" });
  });

  it("远端模型：条目保留独立接口/密钥；切主模型不动条目", async () => {
    const { result } = renderHook(() => useSettingsPage(), {
      wrapper: makeWrapper(),
    });
    await expect.poll(() => result.current.drafts).not.toBeNull();

    await act(async () => {
      await result.current.addRemoteModel({
        name: "gpt-4o",
        baseUrl: "https://api.example.com/v1",
        apiKey: "sk-1",
      });
    });
    const entry = result.current.remoteModelList.find((e) => e.name === "gpt-4o");
    expect(entry?.baseUrl).toBe("https://api.example.com/v1");
    expect(entry?.apiKey).toBe("sk-1");

    // 切换当前模型 → 草稿的 model 变化，条目原样保留
    act(() => {
      result.current.patchLlm({ model: "gpt-4o" });
    });
    expect(result.current.drafts?.llm.model).toBe("gpt-4o");
    expect(result.current.drafts?.llm.extraModels.find((e) => e.name === "gpt-4o")?.baseUrl).toBe(
      "https://api.example.com/v1",
    );
  });

  it("保存 LLM 成功 → 静默（无成功提示）+ 清空 API Key 输入框", async () => {
    const { result } = renderHook(() => useSettingsPage(), {
      wrapper: makeWrapper(),
    });
    await expect.poll(() => result.current.drafts).not.toBeNull();

    act(() => {
      result.current.setLlmApiKey("sk-test");
    });
    await act(async () => {
      await result.current.saveLlm();
    });
    // 即时自动保存：成功静默（用户决策），不再弹「已保存」提示条
    expect(result.current.flash).toBeNull();
    expect(result.current.llmApiKey).toBe("");
    expect(result.current.saving).toBe(false);
  });

  it("保存偏好失败 → err 提示 + saving 复位", async () => {
    behavior = { saveSettingsError: "磁盘只读" };
    const { result } = renderHook(() => useSettingsPage(), {
      wrapper: makeWrapper(),
    });
    await expect.poll(() => result.current.drafts).not.toBeNull();

    await act(async () => {
      await result.current.savePrefs();
    });
    expect(result.current.flash).toEqual({ kind: "err", text: "磁盘只读" });
    expect(result.current.saving).toBe(false);
  });

  it("dbStudioStatus 查询失败 → dbStudioStatus 为 null，启动动作仍可用（#92 回归）", async () => {
    behavior = { dbStudioStatusError: "探测崩溃" };
    const { result } = renderHook(() => useSettingsPage(), {
      wrapper: makeWrapper(),
    });
    await expect.poll(() => result.current.drafts).not.toBeNull();

    await expect.poll(() => result.current.dbStudioStatus).toBeNull();
    /* 状态降级为 null（等同「未运行」）：启动不被锁死，可正常发起 */
    await act(async () => {
      await result.current.startDbStudio();
    });
    expect(result.current.flash).toEqual({
      kind: "ok",
      text: "已启动",
    });
    expect(result.current.dbStudioStarting).toBe(false);
  });

  it("db studio 三个动作不依赖全局 saving：startDbStudio 前后 saving 不被置位（#92 回归）", async () => {
    const { result } = renderHook(() => useSettingsPage(), {
      wrapper: makeWrapper(),
    });
    await expect.poll(() => result.current.drafts).not.toBeNull();

    expect(result.current.saving).toBe(false);
    await act(async () => {
      await result.current.startDbStudio();
    });
    /* 启动完成后 saving 仍为 false——db studio 动作不该动共享 saving 标志 */
    expect(result.current.saving).toBe(false);
    expect(result.current.dbStudioStarting).toBe(false);
  });

  it("远端模型：编辑候选条目（改名/接口/密钥）；重名排除自身", async () => {
    const { result } = renderHook(() => useSettingsPage(), {
      wrapper: makeWrapper(),
    });
    await expect.poll(() => result.current.drafts).not.toBeNull();

    await act(async () => {
      await result.current.addRemoteModel({ name: "gpt-4o", apiKey: "sk-1" });
    });
    let out: { error?: string; ok: boolean } = { ok: false };
    await act(async () => {
      out = await result.current.updateRemoteModel("gpt-4o", {
        name: "gpt-4o-2024",
        baseUrl: "https://api.example.com/v1",
      });
    });
    expect(out.ok).toBe(true);
    const renamed = result.current.remoteModelList.find((e) => e.name === "gpt-4o-2024");
    expect(renamed?.baseUrl).toBe("https://api.example.com/v1");
    /* 未重填、也没勾「清除密钥」→ 这一条**不带 apiKey 键**（= 本次不提供意见）。
     * 此前这里是 `(existing?.apiKey ?? null)`，而真实场景里 `existing` 来自服务端
     * **脱敏下发**的清单（永远没值）→ 折成 null → 覆盖式保存把库里那把密钥清掉
     * （台账 A11）。草稿不该留着它没见过的值。 */
    expect(Object.keys(renamed ?? {})).not.toContain("apiKey");
    expect(result.current.remoteModelList.some((e) => e.name === "gpt-4o")).toBe(false);

    // 改名撞其他候选 → 拒绝；撞生效模型名不拒绝（生效模型不在清单管理范围）
    await act(async () => {
      out = await result.current.updateRemoteModel("gpt-4o-2024", {
        name: "qwen3:14b",
      });
    });
    expect(out.ok).toBe(true);
    await act(async () => {
      await result.current.addRemoteModel({ name: "claude" });
    });
    await act(async () => {
      out = await result.current.updateRemoteModel("claude", {
        name: "qwen3:14b",
      });
    });
    expect(out.ok).toBe(false);

    // 清除独立密钥 → 跟随全局
    await act(async () => {
      out = await result.current.updateRemoteModel("qwen3:14b", {
        clearApiKey: true,
      });
    });
    expect(out.ok).toBe(true);
    expect(result.current.remoteModelList.find((e) => e.name === "qwen3:14b")?.apiKey).toBeNull();
  });

  it("远端模型密钥的三态表达：重填=新值 / 显式清除=null / 都没动=不带这个键（台账 A11）", async () => {
    /* 覆盖式保存（`replaceAll`）里「没带这个键」与「带了 null」是两回事：
     * 前者=我不提供意见（服务端保留既有），后者=用户按了「清除密钥」。
     * 客户端此前把两者压成同一个 `null`（草稿拿的是服务端脱敏后的清单，
     * `existing?.apiKey` 永远是空 → 折成 null），于是「原样保存一次设置」就把
     * 所有远端模型的密钥清掉。三态在这里一次性钉住。 */
    const { result } = renderHook(() => useSettingsPage(), {
      wrapper: makeWrapper(),
    });
    await expect.poll(() => result.current.drafts).not.toBeNull();
    const entryOf = (name: string) => result.current.remoteModelList.find((e) => e.name === name);

    await act(async () => {
      await result.current.addRemoteModel({ name: "m1", apiKey: "sk-old" });
    });
    expect(entryOf("m1")?.apiKey).toBe("sk-old");

    // ① 重填（带空白要去掉）→ 写新值
    await act(async () => {
      await result.current.updateRemoteModel("m1", { apiKey: "  sk-new  " });
    });
    expect(entryOf("m1")?.apiKey).toBe("sk-new");

    // ② 显式清除 → null（服务端据此真的清掉）
    await act(async () => {
      await result.current.updateRemoteModel("m1", { clearApiKey: true });
    });
    expect(entryOf("m1")?.apiKey).toBeNull();

    // ③ 都没动（只改名）→ 这个键根本不出现在条目里
    await act(async () => {
      await result.current.updateRemoteModel("m1", { name: "m1b" });
    });
    expect(entryOf("m1b")).toBeDefined();
    expect(Object.keys(entryOf("m1b") ?? {})).not.toContain("apiKey");
  });

  it("远端模型：编辑未配置条目被拒；改名同步生效模型字段", async () => {
    const { result } = renderHook(() => useSettingsPage(), {
      wrapper: makeWrapper(),
    });
    await expect.poll(() => result.current.drafts).not.toBeNull();

    // llm.model 初始 = "qwen3:14b"，候选为空 —— 不再虚拟「当前模型」行可编辑
    let out: { error?: string; ok: boolean } = { ok: false };
    await act(async () => {
      out = await result.current.updateRemoteModel("qwen3:14b", {
        baseUrl: "https://api.example.com/v1",
      });
    });
    expect(out.ok).toBe(false);

    // 加入与生效模型同名的条目后，改名时同步生效模型字段
    await act(async () => {
      out = await result.current.addRemoteModel({
        name: "qwen3:14b",
        baseUrl: "https://api.example.com/v1",
        apiKey: "sk-main",
      });
    });
    expect(out.ok).toBe(true);
    await act(async () => {
      out = await result.current.updateRemoteModel("qwen3:14b", {
        name: "qwen3:32b",
      });
    });
    expect(out.ok).toBe(true);
    expect(result.current.drafts?.llm.model).toBe("qwen3:32b");
    expect(result.current.drafts?.llm.extraModels[0]?.name).toBe("qwen3:32b");
  });

  /* ── 运行态从设置页走干净了（ISSUE #1900）────────────────────────────
   * 这两条是「搬家搬干净了」的机器判据。它们判的**不是**「新页有没有功能」
   * （那由新页自己的用例管），而是「设置页这一侧有没有偷偷留着第二条通道」——
   * 留着的表现是全绿且看不出来的：状态行没了，但后台每 30s 还在轮询一个没人读的
   * 端点，且与「ComfyUI」页各持一份结论（两份漂了也没人发现）。 */
  it("不再订阅运行态通道（运行态整块归侧栏「ComfyUI」页）", async () => {
    const { result } = renderHook(() => useSettingsPage(), {
      wrapper: makeWrapper(),
    });
    await expect.poll(() => result.current.drafts).not.toBeNull();

    /* 跑够一个宏任务窗口，让首屏那批请求全部落定。 */
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(stateRequests).toEqual([]);
    expect(comfyStatusCalls).toBe(0);
  });

  it("分区切换是纯视觉状态", async () => {
    const { result } = renderHook(() => useSettingsPage(), {
      wrapper: makeWrapper(),
    });
    await expect.poll(() => result.current.drafts).not.toBeNull();

    expect(result.current.section).toBe("llmLocal");
    act(() => {
      result.current.setSection("comfyui");
    });
    expect(result.current.section).toBe("comfyui");
  });

  it("openExternalUrl 打开生成的远程资源 → ok 提示（桌面壳外链替代）", async () => {
    const { result } = renderHook(() => useSettingsPage(), {
      wrapper: makeWrapper(),
    });
    await expect.poll(() => result.current.drafts).not.toBeNull();

    await act(async () => {
      await result.current.openExternalUrl("https://example.com/video.mp4");
    });
    expect(result.current.flash).toEqual({
      kind: "ok",
      text: "已用系统默认浏览器打开",
    });
  });

  it("openExternalUrl 空地址 → err 提示且不发起调用", async () => {
    const { result } = renderHook(() => useSettingsPage(), {
      wrapper: makeWrapper(),
    });
    await expect.poll(() => result.current.drafts).not.toBeNull();

    await act(async () => {
      await result.current.openExternalUrl("");
    });
    expect(result.current.flash).toEqual({
      kind: "err",
      text: "没有可打开的资源地址",
    });
  });

  /* ── 运行态从设置页走干净了（ISSUE #1900）────────────────────────────
   * 这一条判的**不是**「新页有没有功能」（那由新页自己的用例管），而是
   * 「设置页这一侧有没有偷偷留着第二条通道」—— 留着的表现是全绿且看不出来的：
   * 状态行没了，但后台每 30s 还在轮询一个没人读的端点，且与「ComfyUI」页各持一份
   * 结论（两份漂了也没人发现）。 */
  it("运行态清退后零轮询：stateRequests 与 comfyStatus 调用计数都归零", async () => {
    const { result } = renderHook(() => useSettingsPage(), {
      wrapper: makeWrapper(),
    });
    await expect.poll(() => result.current.drafts).not.toBeNull();

    /* 跑够一个宏任务窗口，让首屏那批请求全部落定。 */
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(stateRequests).toEqual([]);
    expect(comfyStatusCalls).toBe(0);
  });

  /* 安装形态此前与运行态挤在同一个响应里，于是被秒级探测拖着：打开设置页先看不到
   * 「安装形态」徽标，「端口 / 启动参数」输入框也要等探测完成才消失（探测本身是
   * 「进程表查询 + 端口探测」，本机负载下到 10s 级）。现在形态走 fs-only 的独立
   * 查询（与首屏配置同批）。这条把「不等探测」钉死 —— 而且设置页这一侧自
   * ISSUE #1900 起压根不再取运行态，所以那条通道的请求数应当**一次都没有**。 */
  it("安装形态不依赖运行态探测：comfyStatus 悬着时形态已经就绪", async () => {
    behavior = { comfyStatusPending: true };
    const { result } = renderHook(() => useSettingsPage(), {
      wrapper: makeWrapper(),
    });

    await expect.poll(() => result.current.comfyInstance).not.toBeNull();
    expect(result.current.comfyInstance?.instanceType).toBe("portable");
    expect(result.current.comfyInstance?.pathConfigured).toBe(true);
    expect(comfyStatusCalls).toBe(0);
  });
});
