import { httpBatchStreamLink, loggerLink, type TRPCLink } from "@trpc/client";
import SuperJSON from "superjson";

import { getTrpcEndpoint, getTrpcEndpointFor } from "./base-url";

/** 客户端自报的身份 —— 服务端日志按它区分请求来自哪条链路。 */
export type TrpcClientSource = "vanilla" | "nextjs-react";

/**
 * tRPC 的 HTTP 链路配置（`vanilla.ts` 与 `react.tsx` 共用）。
 *
 * `transformer` 与 `url` 是**协议的一部分**：两处各写一遍时，任一处改了
 * `SuperJSON` 或路径段，另一个客户端就会静默地连不上或解不开载荷 —— 而这类
 * 错误的现场只有一句「请求失败」，完全指不出是配置分叉。
 *
 * @param source 自报身份，进 `x-trpc-source` 头（服务端日志用）
 * @param origin 显式 origin；省略时按 `getBaseUrl()` 取（应用自己的 origin）。
 *   传值的是「进程外的消费者」（Storybook 工作台），见 `getTrpcEndpointFor`。
 * @param withLogger 是否挂 `loggerLink`。React 客户端挂（dev 下看得到请求），
 *   原生客户端不挂（它服务的是 store 持久化这类后台动作，不需要噪声）。
 */
export function trpcHttpLink(options: {
  source: TrpcClientSource;
  origin?: string;
  withLogger?: boolean;
}): TRPCLink<never>[] {
  const url =
    options.origin === undefined
      ? getTrpcEndpoint()
      : getTrpcEndpointFor(options.origin);

  const http = httpBatchStreamLink({
    transformer: SuperJSON,
    url,
    headers: () => {
      const headers = new Headers();
      headers.set("x-trpc-source", options.source);
      return headers;
    },
  });

  if (!options.withLogger) return [http];

  return [
    loggerLink({
      enabled: (op) =>
        process.env.NODE_ENV === "development" ||
        (op.direction === "down" && op.result instanceof Error),
    }),
    http,
  ] as TRPCLink<never>[];
}
