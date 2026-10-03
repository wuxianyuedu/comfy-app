"use client";

import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import { createTRPCReact } from "@trpc/react-query";
import { type inferRouterInputs, type inferRouterOutputs } from "@trpc/server";
import { useState } from "react";

import type { AppRouter } from "~/server/api/root";
import { createQueryClient } from "./query-client";
import { trpcHttpLink } from "./link";

let clientQueryClientSingleton: QueryClient | undefined = undefined;
const getQueryClient = () => {
  if (typeof window === "undefined") {
    // 服务端：始终新建 query client
    return createQueryClient();
  }
  // 浏览器：用单例模式保持同一个 query client
  clientQueryClientSingleton ??= createQueryClient();

  return clientQueryClientSingleton;
};

export const api = createTRPCReact<AppRouter>();

/**
 * 入参的推导辅助。
 *
 * 用法示例：type HelloInput = RouterInputs['example']['hello']
 */
export type RouterInputs = inferRouterInputs<AppRouter>;

/**
 * 出参的推导辅助。
 *
 * 用法示例：type HelloOutput = RouterOutputs['example']['hello']
 */
export type RouterOutputs = inferRouterOutputs<AppRouter>;

export function TRPCReactProvider(props: { children: React.ReactNode }) {
  const queryClient = getQueryClient();

  const [trpcClient] = useState(() =>
    /* 链路配置与原生客户端共用 `./link` 的 `trpcHttpLink()`（见那里的注释：
       两处各搭一份时，任一处漏改都是静默 404）。`withLogger` 只 React 客户端挂
       —— dev 下看得到请求，而原生客户端服务的是 store 持久化这类后台动作。 */
    api.createClient({
      links: trpcHttpLink({ source: "nextjs-react", withLogger: true }),
    }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <api.Provider client={trpcClient} queryClient={queryClient}>
        {props.children}
      </api.Provider>
    </QueryClientProvider>
  );
}
