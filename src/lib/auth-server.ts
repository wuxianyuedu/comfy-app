/* ── 会话 → 应用用户 的解析（REST Route Handlers 的鉴权边界）────────────────
 *
 * 本模块是 `lib → server` 那条**唯一幸存的越界边**的落点：better-auth 的
 * `getSession` 需要 Next 的请求上下文（`headers()` / cookies），无法下沉到
 * `src/lib`。所以这里不再自己取会话 —— 会话由**调用方注入**（见下），
 * 本模块只负责「会话 → 用户」这段纯领域逻辑，依赖只剩 `lib` 内部。
 *
 * 为什么采用「注入会话」而不是继续 `import "~/server/better-auth/server"`：
 * 那条边让 `src/lib` 的一个模块**无法脱离 Next 观察**（单测必须 mock
 * `better-auth`），而它承载的是「谁在调用、要不要回落演示用户」这类判决。
 * 注入之后：
 *   - REST route 从 `~/server/auth/request-user` 取已经封装好的入口，
 *     不再直接碰 `lib/auth-server`；
 *   - `lib/auth-server` 的用例可以喂任意会话形状，不需要 Next 运行时。
 *
 * `app-settings.json` 的 `loginRequired` 是唯一的登录开关（统一配置管理）：
 *   - false（默认，本机单用户模式）：未登录自动回落演示用户，不限制
 *     「登录才能执行操作」；
 *   - true：无会话返回 null（调用方 401 / UNAUTHORIZED），materials / upload /
 *     logs / llm / custom-nodes / debug 等敏感写入口恢复登录门槛。
 *
 * tRPC 的 `authedProcedure` 与 REST 的 `requireRequestUser` **共用这里的
 * `requireServerUser` 单点判决**——两个 API 面不存在第二份兜底实现。
 */
import { getSettingsSync } from "./app-settings/app-settings.server";
import { userRepository } from "./core/repository";

export type ServerUser = { id: string; email: string; name: string | null };

/** 会话里我们真正用到的部分（better-auth 的会话对象是它的超集）。 */
export type SessionLike = {
  user?: { email?: string | null; name?: string | null };
};

const DEMO_EMAIL = process.env.DEMO_USER_EMAIL ?? "demo@comfy.app";
const DEMO_NAME = "体验用户";

/**
 * 演示用户的进程内 memo。
 *
 * 这里只记 **email**，不记解析结果 —— 这是一个刻意的选择，理由是可验证的：
 * 记住「id / name」会让缓存**越过数据库**：`user` 表被重建（`drizzle-kit push`
 * 的 `__new_X` 重建流程，见 `scripts/heal-db.cjs`）或那行被删掉之后，缓存里
 * 的 id 依然会被返回，而**这个 id 在库里已经不存在**。下游每一处按 userId
 * 写入的地方（任务、工作流、素材）都会 ForeignKey 失败或留下孤儿行，且报错
 * 指向的是写入语句，看不出「用户其实是虚构的」。
 *
 * 换成 `resolveUserByEmail(DEMO_EMAIL)` 走缓存命中，则命中路径依然只有**一次**
 * `findByEmail`（与未命中时的第一次查询同一数量级），而它**必须**真的查库 ——
 * 于是「缓存里有没有」不再与「库里有没有」分叉。取名字的收益（省掉这次查询）
 * 只值一次索引命中，不值得拿「返回不存在的用户」去换。
 *
 * 演示用户仍是确定性的：同一 email → 同一 id，所以重复调用不会反复建行。
 */
let demoUserEmail: string | null = null;

/** 按 email 解析用户，不存在则建号（OAuth 用户首次登录即落库）。 */
async function resolveUserByEmail(
  email: string,
  name: string | null,
): Promise<ServerUser> {
  let user = await userRepository.findByEmail(email);
  user ??= await userRepository.createUser({
    email,
    name,
    password: "oauth-not-used",
  });
  return { id: user.id, email: user.email, name: user.name ?? null };
}

/**
 * 演示用户（无会话时的回退）。
 *
 * 「进程内缓存」只用来确定**用哪个 email**（`DEMO_USER_EMAIL` 一旦读到就固定），
 * 每一行实体仍然查库 —— 见 `demoUserEmail` 上方关于「缓存越过数据库」的说明。
 */
async function getDemoUser(): Promise<ServerUser> {
  demoUserEmail ??= DEMO_EMAIL;
  return resolveUserByEmail(demoUserEmail, DEMO_NAME);
}

/**
 * 已登录 → 真实用户；未登录 → 演示用户（本机单用户模式的兜底）。
 *
 * 调用方负责把会话读出来传进来（见 `~/server/auth/request-user`）。
 */
export async function getServerUser(
  session: SessionLike | null,
): Promise<ServerUser> {
  const email = session?.user?.email;
  if (email) return resolveUserByEmail(email, session?.user?.name ?? null);
  return getDemoUser();
}

/**
 * REST Route Handlers 的鉴权闸：`loginRequired` 打开时无会话返回 null
 * （调用方 401），否则与 `getServerUser` 一样回落演示用户。
 */
export async function requireServerUser(
  session: SessionLike | null,
): Promise<ServerUser | null> {
  const email = session?.user?.email;
  if (email) return resolveUserByEmail(email, session?.user?.name ?? null);
  if (!getSettingsSync().loginRequired) return getDemoUser();
  return null;
}
