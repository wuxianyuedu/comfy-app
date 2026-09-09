/**
 * tests/helpers/renderWithProviders.tsx — 前端集成测试的渲染入口。
 *
 * 把被测组件包进「隔离的」QueryClient + 指向 `/api/trpc` 的真实 tRPC React client
 * （`~/trpc/react` 的 `api`，组件 import 的就是这个实例）。底层 httpBatchStreamLink
 * 打到 `/api/trpc`，由 MSW（见 trpc-msw.ts）拦截并转发到测试 router —— 因此组件里
 * useQuery/useMutation 的 loading → data → error、缓存失效走的是**真实管线**，而不是
 * `vi.mock("~/trpc/vanilla")` 的「永不 resolve pending」桩。
 *
 * 约定：
 *   - 每个 `renderWithProviders` 都新建 QueryClient（retry:false、即时 gc），避免用例间
 *     缓存污染。
 *   - 被测组件必须消费 `~/trpc/react` 的 `api`（即真实路由）；测试文件需自行
 *     `setupTrpcServer(mockRouter)` 并 listen（mockRouter 暴露被测组件用到的真实路径）。
 *   - 若要自建任意路由的集成层自检，可组合 `createTestQueryClient()` + `localApi.Provider`
 *     自行包一层（见 tests/integration/renderWithProviders.integration.test.tsx）。
 *
 * @module tests/helpers/renderWithProviders
 */
import React from "react";
import { render, type RenderOptions, type RenderResult } from "@testing-library/react";
import { QueryClient, QueryClientProvider, type QueryClientConfig } from "@tanstack/react-query";
import { httpBatchStreamLink } from "@trpc/client";
import SuperJSON from "superjson";
import { api } from "~/trpc/react";

const BASE_URL = "http://localhost:3100";

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

export interface ProvidersOptions {
  queryClient?: QueryClient;
  /** 包在 QueryClient/trpc 之外的自定义 Provider（如 ToastProvider）。 */
  wrapper?: React.ComponentType<{ children: React.ReactNode }>;
}

type Options = Omit<RenderOptions, "wrapper"> & ProvidersOptions;

export function renderWithProviders(ui: React.ReactElement, options: Options = {}): RenderResult {
  const { queryClient, wrapper, ...renderOptions } = options;
  const qc = queryClient ?? createTestQueryClient();
  const trpcClient = api.createClient({
    links: [httpBatchStreamLink({ transformer: SuperJSON, url: BASE_URL + "/api/trpc" })],
  });

  const Outer = wrapper ?? (({ children }: { children: React.ReactNode }) => <>{children}</>);

  function CombinedWrapper({ children }: { children: React.ReactNode }) {
    return (
      <Outer>
        <QueryClientProvider client={qc}>
          <api.Provider client={trpcClient} queryClient={qc}>
            {children}
          </api.Provider>
        </QueryClientProvider>
      </Outer>
    );
  }

  return render(ui, { wrapper: CombinedWrapper, ...renderOptions });
}
