/**
 * 隔离 QueryClient + 真实 `~/trpc/react` 的 `api` 打到 `/api/trpc`，由 MSW（`trpc-msw.ts`）转发到测试 router，
 * 故数据态走真实管线而非「永不 resolve」桩。约定：每次新建 QueryClient（retry:false、即时 gc）；组件须消费该 api 且自行 `setupTrpcServer` 后 listen。
 * @module tests/helpers/renderWithProviders — 前端集成测试的渲染入口
 */
import React from "react";
import { render, type RenderOptions, type RenderResult } from "@testing-library/react";
import { QueryClient, QueryClientProvider, type QueryClientConfig } from "@tanstack/react-query";
import { httpBatchStreamLink } from "@trpc/client";
import SuperJSON from "superjson";
import { TRPCProvider, createTrpcClient } from "~/trpc/react";

import { testTrpcEndpoint } from "./test-trpc";

/** 建隔离 QueryClient：禁重试、即时 gc，保证错误/缓存可控。 */
export function createTestQueryClient(): QueryClient {
  const config: QueryClientConfig = {
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
      mutations: { retry: false },
    },
  };
  return new QueryClient(config);
}

export type ProvidersOptions = {
  queryClient?: QueryClient;
  /** 包在 QueryClient/trpc 之外的自定义 Provider（如 ToastProvider）。 */
  wrapper?: React.ComponentType<{ children: React.ReactNode }>;
};

type Options = Omit<RenderOptions, "wrapper"> & ProvidersOptions;

export function renderWithProviders(ui: React.ReactElement, options: Options = {}): RenderResult {
  const { queryClient, wrapper, ...renderOptions } = options;
  const qc = queryClient ?? createTestQueryClient();
  const trpcClient = createTrpcClient({
    links: [httpBatchStreamLink({ transformer: SuperJSON, url: testTrpcEndpoint() })],
  });

  const Outer = wrapper ?? (({ children }: { children: React.ReactNode }) => <>{children}</>);

  function CombinedWrapper({ children }: { children: React.ReactNode }) {
    return (
      <Outer>
        <QueryClientProvider client={qc}>
          <TRPCProvider queryClient={qc} trpcClient={trpcClient}>
            {children}
          </TRPCProvider>
        </QueryClientProvider>
      </Outer>
    );
  }

  return render(ui, { wrapper: CombinedWrapper, ...renderOptions });
}
