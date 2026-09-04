// @vitest-environment jsdom
// 设置页逻辑层单测：hook 走真实 tRPC React 客户端（api.setting.* / api.llm.*），
// 由 MSW 转发到可控测试 router。断言的是**编排行为**：
//   1. 草稿从查询播种（且新的查询结果会重新播种）；
//   2. Ollama 探测触发时机（仅本地 provider + baseUrl 变化时）；
//   3. 按任务温度的合并规则（清空 = 删 key，而不是写 undefined）；
//   4. 三条失败路径都走 flash 提示（硬规则 4：失败必须有用户可见出口）。

import { createElement, type ReactNode } from "react";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { httpBatchStreamLink } from "@trpc/client";
import { TRPCError } from "@trpc/server";
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
  comfyuiUrl: "http://localhost:8188",
  trainerUrl: "",
  defaultVideoWorkflow: "auto",
  comfyLorasDir: "",
  comfyuiPath: "D:/ComfyUI",
  comfyuiExtraArgs: "",
  comfyuiAutoStart: true,
  comfyuiPort: 0,
};

const LLM: LlmConfig = {
  provider: "local",
  baseUrl: "http://localhost:11434/v1",
  model: "qwen3:14b",
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

function makeWrapper() {
  const qc = createTestQueryClient();
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
beforeEach(() => {
  probeMock.mockResolvedValue({ up: true, models: [] });
  startMock.mockResolvedValue(undefined);
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

  it("分区切换是纯视觉状态", async () => {
    const { result } = renderHook(() => useSettingsPage(), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => expect(result.current.drafts).not.toBeNull());

    expect(result.current.section).toBe("llm");
    act(() => result.current.setSection("comfyui"));
    expect(result.current.section).toBe("comfyui");
  });
});
