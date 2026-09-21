import { createTRPCClient, httpBatchStreamLink } from "@trpc/client";
import SuperJSON from "superjson";

import type { AppRouter } from "~/server/api/root";
import { getBaseUrl } from "./base-url";

/**
 * 给用不了 `~/trpc/react` 那套 React hook 的纯 TS 模块（例如
 * canvas-store 的持久化辅助）用的原生（非 React）tRPC 客户端。
 * 同源请求会自动带上会话 cookie，所以
 * better-auth 鉴权与 React 客户端行为一致。
 */
export const vanillaApi = createTRPCClient<AppRouter>({
  links: [
    httpBatchStreamLink({
      transformer: SuperJSON,
      url: getBaseUrl() + "/api/trpc",
      headers: () => {
        const headers = new Headers();
        headers.set("x-trpc-source", "vanilla");
        return headers;
      },
    }),
  ],
});
