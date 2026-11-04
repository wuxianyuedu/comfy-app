/* ── REST Route Handlers 的鉴权入口（会话读取 + 用户解析的唯一落点）──────────────────
 * `src/lib/auth-server.ts` 只做「会话 → 用户」判决（依赖仅在 lib 内）；本模块是**唯一**读 Next 上下文
 * （better-auth `getSession`）的地方，把会话交给它 —— 消除 `lib → server` 越界边（§18.9）。不把 headers 当参数
 * 传给 `lib`：24 个 route 得各写 `new Headers(await headers())`；`getSession` 已 await 且带 React `cache()`，复用最短。
 */
import "server-only";

import { getSession } from "~/server/better-auth/server";
import { requireServerUser, type ServerUser, type SessionLike } from "~/lib/auth-server";

/**
 * 鉴权闸（REST 面唯一入口）：`loginRequired` 打开时无会话返回 null（调用方回 401），否则回落演示用户。
 * 刻意不提供「总是兜底演示用户」的第二入口 —— 那会把 `loginRequired` 变成可被单个路由误绕过的建议。
 * tRPC 面的对应闸门 `authedProcedure` 与本函数共用 `requireServerUser` 单点判决。
 */
export async function requireRequestUser(): Promise<ServerUser | null> {
  return requireServerUser(await readSession());
}

/** 读会话。`getSession` 是 React `cache()` 包装的，同一请求内重复调用只读一次。 */
async function readSession(): Promise<SessionLike | null> {
  return await getSession();
}
