"use client";

import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import { createTRPCClient, type TRPCLink } from "@trpc/client";
import { createTRPCContext } from "@trpc/tanstack-react-query";
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

/**
 * tRPC × TanStack Query 的集成入口（官方现在推荐的这一条，取代 classic 的
 * `createTRPCReact`）。
 *
 * 与 classic 的差别不是换个导入名，是**调用形状**变了：procedure 从「挂在代理上的
 * hook」变成「产出 options 的工厂」，hook 本体回到 TanStack 那边——
 *   · 查询 `useQuery(trpc.x.y.queryOptions(input, tanstackOpts))`
 *   · 变更 `useMutation(trpc.x.y.mutationOptions(opts))`
 *   · 失效 `queryClient.invalidateQueries(trpc.x.y.queryFilter(input))`
 *
 * ⚠️ 视图层因此不再出现 `api.x.y.useQuery` 这种字样，而硬规则 10 的判据
 * （`scripts/check-ui-logic-separation.cjs` 的 S3）**原本只认那种字样**。
 * 迁移同批必须把 S3 改成认 `queryOptions(` / `mutationOptions(`，否则「视图层
 * 新增 IO」这条闸会静默失明——判据跟着调用形状走，形状换了判据就得换。
 */
export const { TRPCProvider, useTRPC } = createTRPCContext<AppRouter>();

/**
 * 按给定链路建一个与本 hub **同类型**的 tRPC 客户端。
 *
 * 给测试与组件工作台用：它们要指向测试端点或另一个 origin，链路自己拼，但
 * `TRPCProvider` 吃的是 `TRPCClient<AppRouter>` —— 各调用点自己写
 * `createTRPCClient<AppRouter>` 就得各自 import `AppRouter`（而 `src/**` 的测试
 * import 服务端根是有边界判据的），一处类型参数换七处重复。
 */
export function createTrpcClient(options: { links: Array<TRPCLink<never>> }) {
  return createTRPCClient<AppRouter>(options);
}

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
    createTRPCClient<AppRouter>({
      links: trpcHttpLink({ source: "nextjs-react", withLogger: true }),
    }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <TRPCProvider queryClient={queryClient} trpcClient={trpcClient}>
        {props.children}
      </TRPCProvider>
    </QueryClientProvider>
  );
}
