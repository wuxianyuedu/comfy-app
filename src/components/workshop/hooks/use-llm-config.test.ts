import { createElement, type ReactNode } from "react";
import { renderHook, waitFor } from "@testing-library/react";
import type { QueryClient } from "@tanstack/react-query";
import { QueryClientProvider } from "@tanstack/react-query";
import { httpBatchStreamLink } from "@trpc/client";
import SuperJSON from "superjson";
import { describe, expect, it, afterAll, afterEach, beforeAll } from "vitest";

import { createTestQueryClient } from "../../../../tests/helpers/renderWithProviders";
import { createTestTRPC } from "../../../../tests/helpers/test-trpc";
import { setupTrpcServer } from "../../../../tests/helpers/trpc-msw";
import { api } from "~/trpc/react";

import { useLLMConfig } from "./use-llm-config";

const CFG = {
  provider: "local",
  baseUrl: "http://localhost:11434/v1",
  model: "qwen3:14b",
  extraModels: [
    "qwen3:14b",
    "llama3",
    // chat 类型
    { name: "gpt-4o", baseUrl: "https://x/v1", apiKey: "k", kind: "chat" },
    // kind 缺省 → 按 chat 处理
    { name: "legacy-model", baseUrl: "https://w/v1", apiKey: "k" },
    // 图片 / 视频类型 → 不应收入工坊文本候选
    { name: "dall-e-3", baseUrl: "https://y/v1", apiKey: "k", kind: "image" },
    { name: "sora", baseUrl: "https://z/v1", apiKey: "k", kind: "video" },
  ],
  temperature: 0.7,
  maxTokens: 2048,
  hasApiKey: false,
};

const t = createTestTRPC();
/** 可变配置源：生效提供方相关用例按场景替换 configGet 的返回（各自新建
 *  QueryClient，缓存不跨用例污染；用例结束不还原——下一个用例会自行设置）。 */
let currentCfg: unknown = CFG;
const mockRouter = t.router({
  llm: t.router({
    configGet: t.procedure.query(() => ({ config: currentCfg })),
  }),
});
const server = setupTrpcServer(mockRouter);

function makeWrapper(qc: QueryClient) {
  const client = api.createClient({
    links: [
      httpBatchStreamLink({
        transformer: SuperJSON,
        url: "http://localhost:3100/api/trpc",
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

beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe("useLLMConfig 播种：本地/远端候选拆出", () => {
  it("冷启动（无缓存）能拆出 local/remote", async () => {
    const qc = createTestQueryClient();
    const { result } = renderHook(() => useLLMConfig(), {
      wrapper: makeWrapper(qc),
    });
    await waitFor(() =>
      expect(result.current.localModels.length).toBeGreaterThan(0),
    );
    expect(result.current.localModels).toContain("llama3");
    expect(result.current.remoteModels).toContain("gpt-4o");
  });

  it("热重挂（配置已在查询缓存）仍应拆出 local/remote", async () => {
    const qc = createTestQueryClient();
    const first = renderHook(() => useLLMConfig(), {
      wrapper: makeWrapper(qc),
    });
    await waitFor(() =>
      expect(first.result.current.localModels.length).toBeGreaterThan(0),
    );
    first.unmount();

    // 查询缓存仍在，首帧即命中 —— 回归：播种守卫若只比引用会被缓存命中跳过。
    const { result } = renderHook(() => useLLMConfig(), {
      wrapper: makeWrapper(qc),
    });
    await waitFor(() =>
      expect(result.current.localModels.length).toBeGreaterThan(0),
    );
    expect(result.current.localModels).toContain("llama3");
    expect(result.current.remoteModels).toContain("gpt-4o");
  });
});

describe("useLLMConfig 远端模型 kind 过滤", () => {
  it("图片/视频 kind 的远端模型不收入工坊文本候选", async () => {
    const qc = createTestQueryClient();
    const { result } = renderHook(() => useLLMConfig(), {
      wrapper: makeWrapper(qc),
    });
    await waitFor(() =>
      expect(result.current.remoteModels.length).toBeGreaterThan(0),
    );

    // chat kind 与 kind 缺省（null → chat）都应保留
    expect(result.current.remoteModels).toContain("gpt-4o");
    expect(result.current.remoteModels).toContain("legacy-model");

    // image / video kind 不收入文本生成候选
    expect(result.current.remoteModels).not.toContain("dall-e-3");
    expect(result.current.remoteModels).not.toContain("sora");

    // config.extraModels 同样只收文本可用模型
    expect(result.current.config?.extraModels).toContain("gpt-4o");
    expect(result.current.config?.extraModels).toContain("legacy-model");
    expect(result.current.config?.extraModels).not.toContain("dall-e-3");
    expect(result.current.config?.extraModels).not.toContain("sora");
  });
});

describe("useLLMConfig 远端生图模型清单", () => {
  it("kind=image 的远端条目单独暴露给定妆照远端通道挑选", async () => {
    const qc = createTestQueryClient();
    const { result } = renderHook(() => useLLMConfig(), {
      wrapper: makeWrapper(qc),
    });
    await waitFor(() =>
      expect(result.current.remoteImageModels.length).toBeGreaterThan(0),
    );
    expect(result.current.remoteImageModels).toContain("dall-e-3");
    // chat / video 条目不进生图清单
    expect(result.current.remoteImageModels).not.toContain("gpt-4o");
    expect(result.current.remoteImageModels).not.toContain("sora");
  });
});

describe("useLLMConfig 生效提供方（本机 ollama 误存为「远端」的归组修正）", () => {
  it("provider=remote 但 baseUrl 回环且无密钥 → 主模型归本地组，config.provider 按本地生效", async () => {
    currentCfg = {
      provider: "remote",
      baseUrl: "http://127.0.0.1:11434/v1",
      model: "qwen3:14b",
      extraModels: ["llama3"],
      temperature: 0.7,
      maxTokens: 2048,
      hasApiKey: false,
    };
    const qc = createTestQueryClient();
    const { result } = renderHook(() => useLLMConfig(), {
      wrapper: makeWrapper(qc),
    });
    await waitFor(() => expect(result.current.config).not.toBeNull());
    expect(result.current.localModels).toContain("qwen3:14b");
    expect(result.current.remoteModels).not.toContain("qwen3:14b");
    // 徽标 / 页脚等消费 config.provider 的展示点据此显示「本地」
    expect(result.current.config?.provider).toBe("local");
  });

  it("回环但配置了密钥（本机网关转发远端的形态）→ 仍按远端分组", async () => {
    currentCfg = {
      provider: "remote",
      baseUrl: "http://127.0.0.1:3000/v1",
      model: "qwen3:14b",
      extraModels: [],
      apiKey: "sk-gateway",
      temperature: 0.7,
      maxTokens: 2048,
      hasApiKey: true,
    };
    const qc = createTestQueryClient();
    const { result } = renderHook(() => useLLMConfig(), {
      wrapper: makeWrapper(qc),
    });
    await waitFor(() => expect(result.current.config).not.toBeNull());
    expect(result.current.remoteModels).toContain("qwen3:14b");
    expect(result.current.config?.provider).toBe("remote");
  });

  it("真远端（非回环）配置不受影响，主模型归远端组", async () => {
    currentCfg = {
      provider: "remote",
      baseUrl: "https://api.openai.com/v1",
      model: "gpt-4o",
      extraModels: [],
      temperature: 0.7,
      maxTokens: 2048,
      hasApiKey: false,
    };
    const qc = createTestQueryClient();
    const { result } = renderHook(() => useLLMConfig(), {
      wrapper: makeWrapper(qc),
    });
    await waitFor(() => expect(result.current.config).not.toBeNull());
    expect(result.current.remoteModels).toContain("gpt-4o");
    expect(result.current.config?.provider).toBe("remote");
  });
});
