/* ── REST Route Handlers 的鉴权入口（会话读取 + 用户解析的唯一落点）─────────
 *
 * 分工刻意分成两层：
 *   - `src/lib/auth-server.ts`：纯「会话 → 用户」判决（含演示用户兜底），
 *     依赖只有 `lib` 内部，可脱离 Next 观察；
 *   - 本模块：**唯一**读 Next 请求上下文（better-auth `getSession`）的地方，
 *     把会话读出来交给上面那份判决。
 *
 * 这样 `lib → server` 的越界边被消除（§18.10 登记的最后一 条），
 * 而「谁需要 Next 运行时」这件事收在 `src/server/**` 里 —— 那本来就是它
 * 的定义（§18.4：`src/server` 是服务端物，不需要逐个补 `server-only`）。
 *
 * 为什么不做成「`lib/auth-server` 接收 headers 参数」：那样调用方（24 个
 * REST route）每处都要写一遍 `new Headers(await headers())`，等于把 Next
 * 依赖摊回每一个路由；而 `getSession` 内部已经 `await headers()` 并带
 * React `cache()`（同一次请求内去重），照旧复用它才是最短路径。
 */
import "server-only";

import { getSession } from "~/server/better-auth/server";
import {
  getServerUser,
  requireServerUser,
  type ServerUser,
  type SessionLike,
} from "~/lib/auth-server";

/**
 * 取当前用户：已登录 → 真实用户；未登录 → 演示用户（本机单用户模式）。
 *
 * 演示用户兜底与 tRPC `authedProcedure` 的回退口径一致（见 §1.9）。
 */
export async function currentServerUser(): Promise<ServerUser> {
  return getServerUser(await readSession());
}

/**
 * 鉴权闸：`app-settings.json` 的 `loginRequired` 打开时，无会话返回 null
 * （调用方回 401）；否则回落演示用户。
 */
export async function requireRequestUser(): Promise<ServerUser | null> {
  return requireServerUser(await readSession());
}

/** 读会话。`getSession` 是 React `cache()` 包装的，同一请求内重复调用只读一次。 */
async function readSession(): Promise<SessionLike | null> {
  return await getSession();
}
