import { createTRPCClient } from "@trpc/client";

import type { AppRouter } from "~/server/api/root";
import { trpcHttpLink } from "./link";

/**
 * 给用不了 `~/trpc/react` 那套 React hook 的纯 TS 模块（例如
 * canvas-store 的持久化辅助）用的原生（非 React）tRPC 客户端。
 * 同源请求会自动带上会话 cookie，所以
 * better-auth 鉴权与 React 客户端行为一致。
 *
 * 链路配置（`transformer` / 端点 / 自报身份）与 React 客户端共用
 * `./link` 的 `trpcHttpLink()` —— 两处各搭一份时，任一处漏改都是静默 404 或
 * 载荷解不开，而现场只有一句「请求失败」。
 */
export const vanillaApi = createTRPCClient<AppRouter>({
  links: trpcHttpLink({ source: "vanilla" }),
});
