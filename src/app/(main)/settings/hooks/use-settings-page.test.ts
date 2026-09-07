// @vitest-environment jsdom
// 设置页逻辑层单测：hook 走真实 tRPC React 客户端（api.setting.* / api.llm.*），
// 由 MSW 转发到可控测试 router。断言的是**编排行为**：
//   1. 草稿从查询播种（且新的查询结果会重新播种）；
//   2. Ollama 探测触发时机（仅本地 provider + baseUrl 变化时）；
//   3. 按任务温度的合并规则（清空 = 删 key，而不是写 undefined）；
//   4. 失败路径都走 flash 提示（硬规则 4：失败必须有用户可见出口）；
//   5. openExternalUrl 把生成结果交给系统默认浏览器打开（桌面壳替代外链）。

import { createElement, type ReactNode } from "react";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchStreamLink } from "@trpc/client";
import { TRPCError } from "@trpc/server";
import { http, HttpResponse } from "msw";
import SuperJSON from "superjson";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { createTestQueryClient } from "../../../../../tests/helpers/renderWithProviders";
import { createTestTRPC } from "../../../../../tests/helpers/test-trpc";
import { setupTrpcServer } from "../../../../../tests/helpers/trpc-msw";
import { api } from "~/trpc/react";
import { probeOllama, startOllama } from "~/lib/llm/ollama-client";

import {
  useSettingsPage,
  type LlmConfig,
  type Settings,
} from "./use-settings-page";

vi.mock("~/lib/llm/ollama-client", () => ({
  probeOllama: vi.fn(),
  startOllama: vi.fn(),
}));

const probeMock = vi.mocked(probeOllama);
const startMock = vi.mocked(startOllama);

const SETTINGS: Settings = {
  trainerUrl: "",
  defaultVideoWorkflow: "auto",
  comfyLorasDir: "",
  comfyuiPath: "D:/ComfyUI",
  comfyuiExtraArgs: "",
  comfyuiAutoStart: true,
  comfyuiPort: 0,
  exitKillComfyui: true,
  exitKillOllama: true,
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

interface Behavior {
  settings?: Settings;
  llm?: LlmConfig;
  llmError?: string;
  saveLlmError?: string;
  saveSettingsError?: string;
  comfyStart?: { ok: boolean; detail: string };
  dbStudioStatusError?: string;
  dbStudioUp?: boolean;
}

let behavior: Behavior = {};

const t = createTestTRPC();
const mockRouter = t.router({
  setting: t.router({
    get: t.procedure.query(() => ({ settings: behavior.settings ?? SETTINGS })),
    save: t.procedure.mutation(() => {
      if (behavior.saveSettingsError) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: behavior.saveSettingsError,
        });
      }
      return { settings: behavior.settings ?? SETTINGS };
    }),
    comfyStatus: t.procedure.query(() => ({
      up: false,
      base: null,
      starting: false,
      pathConfigured: true,
    })),
    comfyStart: t.procedure.mutation(
      () => behavior.comfyStart ?? { ok: true, detail: "已启动" },
    ),
    comfyStop: t.procedure.mutation(() => ({
      ok: true,
      detail: "已关闭",
    })),
    comfyOpen: t.procedure.mutation(() => ({
      ok: true,
      detail: "已用系统默认浏览器打开 ComfyUI",
    })),
    /* Drizzle Studio：新增分区拉起的 status 查询与动作，均需有 mock handler，
     * 否则 onUnhandledRequest:error 会让渲染整个 hook 的用例全挂 */
    dbStudioStatus: t.procedure.query(() => {
      if (behavior.dbStudioStatusError) {
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
      if (behavior.llmError) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: behavior.llmError,
        });
      }
      return { config: behavior.llm ?? LLM };
    }),
    configSave: t.procedure.mutation(() => {
      if (behavior.saveLlmError) {
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
  const client = api.createClient({
    links: [
      httpBatchStreamLink({
        transformer: SuperJSON,
        url: "http://localhost:3000/api/trpc",
      }),
    ],
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(
      QueryClientProvider,
      { client: qc },
      // eslint-disable-next-line react/no-children-prop -- createElement 的第三参即 children
      createElement(api.Provider, { client, queryClient: qc, children }),
    );
  };
}

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
/* 默认「Ollama 运行中」：不设默认值时 vi.fn() 返回 undefined，探测回调会在
 * 上一个用例卸载后跑到，产生「Cannot read properties of undefined」的
 * unhandled rejection（表现为用例绿但文件红）。 */
/* /api/logs/current 默认 handler：启动 ComfyUI 的用例里 hook 会开始跟随轮询
 * comfyui-runtime 日志，没有 handler 会以 onUnhandledRequest:error 报
 * unhandled rejection（与上面 probeMock 同源问题）。 */
beforeEach(() => {
  probeMock.mockResolvedValue({ up: true, models: [] });
  startMock.mockResolvedValue(undefined);
  server.use(
    http.get("*/api/logs/current", ({ request }) => {
      const url = new URL(request.url);
      if (url.searchParams.get("source") !== "comfyui-runtime") {
        return HttpResponse.json(
          { error: "unexpected source" },
          { status: 400 },
        );
      }
      return HttpResponse.json({ content: "", size: 0, offset: 0 });
    }),
  );
});
afterEach(() => {
  cleanup();
  behavior = {};
  server.resetHandlers();
});
afterAll(() => server.close());

describe("useSettingsPage", () => {
  it("草稿从查询结果播种，两份齐了才算 ready", async () => {
    const { result } = renderHook(() => useSettingsPage(), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => expect(result.current.drafts).not.toBeNull());
    expect(result.current.drafts?.llm.model).toBe("qwen3:14b");
    expect(result.current.drafts?.settings.comfyuiPath).toBe("D:/ComfyUI");
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
    await waitFor(() => expect(first.result.current.drafts).not.toBeNull());
    // 关闭（卸载），缓存保留
    first.unmount();

    // 再打开：QueryClient 仍在，query 命中缓存，首帧即就绪
    const second = renderHook(() => useSettingsPage(), {
      wrapper: makeWrapper(qc),
    });
    await waitFor(() => expect(second.result.current.drafts).not.toBeNull());
    expect(second.result.current.drafts?.llm.model).toBe("qwen3:14b");
    expect(second.result.current.drafts?.settings.comfyuiPath).toBe(
      "D:/ComfyUI",
    );
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
    await waitFor(() => expect(result.current.drafts).not.toBeNull());
    await waitFor(() => expect(result.current.ollamaStatus).toBe("up"));
    expect(result.current.ollamaModels).toHaveLength(1);
    expect(probeMock).toHaveBeenCalledWith("http://localhost:11434/v1");

    const callsAfterLocalProbe = probeMock.mock.calls.length;
    act(() => result.current.patchLlm({ provider: "remote" }));
    /* 探测是 setTimeout(…, 0) 里触发的，切到远端后要等一个宏任务再断言，
     * 确认没有新的探测被排进去。 */
    await act(async () => {
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
    await waitFor(() => expect(result.current.drafts).not.toBeNull());
    await waitFor(() => expect(result.current.ollamaStatus).toBe("down"));
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
    const { result } = renderHook(() => useSettingsPage(), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => expect(result.current.ollamaStatus).toBe("down"));
    expect(result.current.ollamaStarting).toBe(false);

    vi.useFakeTimers();
    try {
      let starting: Promise<void> = Promise.resolve();
      await act(async () => {
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
    const { result } = renderHook(() => useSettingsPage(), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => expect(result.current.ollamaStatus).toBe("down"));

    vi.useFakeTimers();
    try {
      let starting: Promise<void> = Promise.resolve();
      await act(async () => {
        starting = result.current.startOllama();
      });
      expect(result.current.ollamaStatus).toBe("starting");

      // 推进两轮轮询（探测都 down），状态行必须保持 starting
      await vi.advanceTimersByTimeAsync(5_000);
      expect(result.current.ollamaStatus).toBe("starting");
      expect(result.current.ollamaStarting).toBe(true);

      // 第 3 轮起探测 up → 状态行一次性落到 up
      probeMock.mockResolvedValue({ up: true, models: [] });
      await vi.advanceTimersByTimeAsync(5_000);
      await act(async () => {
        await starting;
      });
      expect(result.current.ollamaStatus).toBe("up");
      expect(result.current.ollamaStarting).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("startOllama 失败 → flash 出可读文案（失败路径必须有出口）", async () => {
    probeMock.mockResolvedValue({ up: false });
    startMock.mockRejectedValue(new Error("spawn ENOENT"));
    const { result } = renderHook(() => useSettingsPage(), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => expect(result.current.drafts).not.toBeNull());

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
    await waitFor(() => expect(result.current.drafts).not.toBeNull());

    act(() => result.current.setTaskTemperature("code", "0.1"));
    expect(result.current.drafts?.llm.temperatureByTask).toEqual({ code: 0.1 });

    act(() => result.current.setTaskTemperature("chat", "0.9"));
    expect(result.current.drafts?.llm.temperatureByTask).toEqual({
      code: 0.1,
      chat: 0.9,
    });

    // 清空 = 删 key，而不是留下 undefined（否则「已覆盖」徽标一直亮）
    act(() => result.current.setTaskTemperature("code", ""));
    expect(result.current.drafts?.llm.temperatureByTask).toEqual({ chat: 0.9 });

    // 最后一个也清空 → 整个 map 回到 undefined
    act(() => result.current.setTaskTemperature("chat", ""));
    expect(result.current.drafts?.llm.temperatureByTask).toBeUndefined();
  });

  it("远端模型：添加/移除即时落库（重名/空名拒绝）；生效模型字段不受清单管理", async () => {
    const { result } = renderHook(() => useSettingsPage(), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => expect(result.current.drafts).not.toBeNull());

    // 设置页只做配置：初始清单 = 候选条目（不含「当前模型」虚拟行）
    expect(result.current.remoteModelList.map((e) => e.name)).toEqual([]);

    let out: { ok: boolean; error?: string } = { ok: false };
    await act(async () => {
      out = await result.current.addRemoteModel({ name: "gpt-4o" });
    });
    expect(out.ok).toBe(true);
    expect(result.current.remoteModelList.map((e) => e.name)).toEqual([
      "gpt-4o",
    ]);
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
    expect(result.current.remoteModelList.map((e) => e.name)).toEqual([
      "gpt-4o",
      "qwen3:14b",
    ]);

    // 移除即时落库，只动清单不碰生效模型字段（运行时在工坊切换）
    await act(async () => {
      out = await result.current.removeRemoteModel("gpt-4o");
    });
    expect(out.ok).toBe(true);
    expect(result.current.remoteModelList.map((e) => e.name)).toEqual([
      "qwen3:14b",
    ]);
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
    await waitFor(() => expect(result.current.drafts).not.toBeNull());

    let out: { ok: boolean; error?: string } = { ok: false };
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
    await waitFor(() => expect(result.current.drafts).not.toBeNull());

    await act(async () => {
      await result.current.addRemoteModel({
        name: "gpt-4o",
        baseUrl: "https://api.example.com/v1",
        apiKey: "sk-1",
      });
    });
    const entry = result.current.remoteModelList.find(
      (e) => e.name === "gpt-4o",
    );
    expect(entry?.baseUrl).toBe("https://api.example.com/v1");
    expect(entry?.apiKey).toBe("sk-1");

    // 切换当前模型 → 草稿的 model 变化，条目原样保留
    act(() => {
      result.current.patchLlm({ model: "gpt-4o" });
    });
    expect(result.current.drafts?.llm.model).toBe("gpt-4o");
    expect(
      result.current.drafts?.llm.extraModels.find((e) => e.name === "gpt-4o")
        ?.baseUrl,
    ).toBe("https://api.example.com/v1");
  });

  it("保存 LLM 成功 → ok 提示 + 清空 API Key 输入框", async () => {
    const { result } = renderHook(() => useSettingsPage(), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => expect(result.current.drafts).not.toBeNull());

    act(() => result.current.setLlmApiKey("sk-test"));
    await act(async () => {
      await result.current.saveLlm();
    });
    expect(result.current.flash).toEqual({
      kind: "ok",
      text: "LLM 配置已保存",
    });
    expect(result.current.llmApiKey).toBe("");
    expect(result.current.saving).toBe(false);
  });

  it("保存偏好失败 → err 提示 + saving 复位", async () => {
    behavior = { saveSettingsError: "磁盘只读" };
    const { result } = renderHook(() => useSettingsPage(), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => expect(result.current.drafts).not.toBeNull());

    await act(async () => {
      await result.current.savePrefs();
    });
    expect(result.current.flash).toEqual({ kind: "err", text: "磁盘只读" });
    expect(result.current.saving).toBe(false);
  });

  it("ComfyUI 启动：后端返回 detail 直接进提示条", async () => {
    behavior = { comfyStart: { ok: false, detail: "未找到 main.py" } };
    const { result } = renderHook(() => useSettingsPage(), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => expect(result.current.drafts).not.toBeNull());

    await act(async () => {
      await result.current.startComfy();
    });
    expect(result.current.flash).toEqual({
      kind: "err",
      text: "未找到 main.py",
    });
    expect(result.current.comfyStarting).toBe(false);
  });

  it("refreshComfyLog 拉取 comfyui-runtime 日志（替换式），未启动时不在跟随态", async () => {
    server.use(
      http.get("*/api/logs/current", ({ request }) => {
        const url = new URL(request.url);
        if (url.searchParams.get("source") !== "comfyui-runtime") {
          return HttpResponse.json(
            { error: "unexpected source" },
            { status: 400 },
          );
        }
        return HttpResponse.json({
          content: "[spawn] pid=123 cmd=python.exe\n[out] Starting ComfyUI\n",
          size: 2048,
          offset: 0,
        });
      }),
    );
    const { result } = renderHook(() => useSettingsPage(), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => expect(result.current.drafts).not.toBeNull());

    await act(async () => {
      await result.current.refreshComfyLog();
    });
    expect(result.current.comfyLogText).toContain("[spawn] pid=123");
    expect(result.current.comfyLogActive).toBe(false);
  });

  it("refreshDbStudioLog 拉取 drizzle-studio-runtime 日志（替换式）", async () => {
    server.use(
      http.get("*/api/logs/current", ({ request }) => {
        const url = new URL(request.url);
        if (url.searchParams.get("source") !== "drizzle-studio-runtime") {
          return HttpResponse.json(
            { error: "unexpected source" },
            { status: 400 },
          );
        }
        return HttpResponse.json({
          content:
            "[spawn] pid=456 cmd=node.exe\ndrizzle-kit studio\n[out] Drizzle Studio is running\n",
          size: 4096,
          offset: 0,
        });
      }),
    );
    const { result } = renderHook(() => useSettingsPage(), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => expect(result.current.drafts).not.toBeNull());

    await act(async () => {
      await result.current.refreshDbStudioLog();
    });
    expect(result.current.dbStudioLogText).toContain("[spawn] pid=456");
    expect(result.current.dbStudioLogText).toContain("Drizzle Studio is running");
    expect(result.current.dbStudioLogActive).toBe(false);
  });

  it("refreshOllamaLog 拉取 ollama-runtime 日志（替换式），未启动时不在跟随态", async () => {
    server.use(
      http.get("*/api/logs/current", ({ request }) => {
        const url = new URL(request.url);
        if (url.searchParams.get("source") !== "ollama-runtime") {
          return HttpResponse.json(
            { error: "unexpected source" },
            { status: 400 },
          );
        }
        return HttpResponse.json({
          content:
            "[spawn] pid=789 cmd=ollama.exe args=[\"serve\"]\n[out] starting ollama serve\n[state] Ollama 已关闭\n",
          size: 4096,
          offset: 0,
        });
      }),
    );
    const { result } = renderHook(() => useSettingsPage(), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => expect(result.current.drafts).not.toBeNull());

    await act(async () => {
      await result.current.refreshOllamaLog();
    });
    expect(result.current.ollamaLogText).toContain("[spawn] pid=789");
    expect(result.current.ollamaLogText).toContain("starting ollama serve");
    expect(result.current.ollamaLogActive).toBe(false);
  });

  it("dbStudioStatus 查询失败 → dbStudioStatus 为 null，启动动作仍可用（#92 回归）", async () => {
    behavior = { dbStudioStatusError: "探测崩溃" };
    const { result } = renderHook(() => useSettingsPage(), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => expect(result.current.drafts).not.toBeNull());

    await waitFor(() =>
      expect(result.current.dbStudioStatus).toBeNull(),
    );
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
    await waitFor(() => expect(result.current.drafts).not.toBeNull());

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
    await waitFor(() => expect(result.current.drafts).not.toBeNull());

    await act(async () => {
      await result.current.addRemoteModel({ name: "gpt-4o", apiKey: "sk-1" });
    });
    let out: { ok: boolean; error?: string } = { ok: false };
    await act(async () => {
      out = await result.current.updateRemoteModel("gpt-4o", {
        name: "gpt-4o-2024",
        baseUrl: "https://api.example.com/v1",
      });
    });
    expect(out.ok).toBe(true);
    const renamed = result.current.remoteModelList.find(
      (e) => e.name === "gpt-4o-2024",
    );
    expect(renamed?.baseUrl).toBe("https://api.example.com/v1");
    /* 未提供 apiKey → 保留原值 */
    expect(renamed?.apiKey).toBe("sk-1");
    expect(
      result.current.remoteModelList.some((e) => e.name === "gpt-4o"),
    ).toBe(false);

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
    expect(
      result.current.remoteModelList.find((e) => e.name === "qwen3:14b")
        ?.apiKey,
    ).toBeNull();
  });

  it("远端模型：编辑未配置条目被拒；改名同步生效模型字段", async () => {
    const { result } = renderHook(() => useSettingsPage(), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => expect(result.current.drafts).not.toBeNull());

    // llm.model 初始 = "qwen3:14b"，候选为空 —— 不再虚拟「当前模型」行可编辑
    let out: { ok: boolean; error?: string } = { ok: false };
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

  it("分区切换是纯视觉状态", async () => {
    const { result } = renderHook(() => useSettingsPage(), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => expect(result.current.drafts).not.toBeNull());

    expect(result.current.section).toBe("llmLocal");
    act(() => result.current.setSection("comfyui"));
    expect(result.current.section).toBe("comfyui");
  });

  it("openExternalUrl 打开生成的远程资源 → ok 提示（桌面壳外链替代）", async () => {
    const { result } = renderHook(() => useSettingsPage(), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => expect(result.current.drafts).not.toBeNull());

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
    await waitFor(() => expect(result.current.drafts).not.toBeNull());

    await act(async () => {
      await result.current.openExternalUrl("");
    });
    expect(result.current.flash).toEqual({
      kind: "err",
      text: "没有可打开的资源地址",
    });
  });
});
