// @vitest-environment jsdom
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
    { name: "gpt-4o", baseUrl: "https://x/v1", apiKey: "k", kind: "chat" },
  ],
  temperature: 0.7,
  maxTokens: 2048,
  hasApiKey: false,
};

const t = createTestTRPC();
const mockRouter = t.router({
  llm: t.router({
    configGet: t.procedure.query(() => ({ config: CFG })),
  }),
});
const server = setupTrpcServer(mockRouter);

function makeWrapper(qc: QueryClient) {
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
    const first = renderHook(() => useLLMConfig(), { wrapper: makeWrapper(qc) });
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
