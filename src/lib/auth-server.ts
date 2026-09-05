import { getSession } from "~/server/better-auth/server";
import { getSettingsSync } from "./app-settings";
import { userRepository } from "./core";

export type ServerUser = { id: string; email: string; name: string | null };

const DEMO_EMAIL = process.env.DEMO_USER_EMAIL ?? "demo@comfy.app";

// The demo user is deterministic (same email → same id) and never changes
// within a server session, so we memoize it.  This avoids a Prisma round-trip
// on every unauthenticated request — critical for keeping hot API paths
// (e.g. the workflow-canvas detail) fast, since getServerUser() otherwise runs
// a findUnique (or create) on each call.
let demoUserCache: ServerUser | null = null;

/**
 * Returns the real logged-in user when a session exists; otherwise falls back
 * to a lazily-created demo user so the app keeps working in local single-user
 * mode (and the smoke scripts that hit the API without a cookie keep passing).
 *
 * Uses better-auth's getSession (migrated from NextAuth v5).
 */
export async function getServerUser(): Promise<ServerUser> {
  const session = await getSession();
  if (session?.user?.email) {
    let user = await userRepository.findByEmail(session.user.email);
    user ??= await userRepository.createUser({
      email: session.user.email,
      name: session.user.name ?? null,
      password: "oauth-not-used",
    });
    return { id: user.id, email: user.email, name: user.name ?? null };
  }

  if (demoUserCache) return demoUserCache;
  let demo = await userRepository.findByEmail(DEMO_EMAIL);
  demo ??= await userRepository.createUser({
    email: DEMO_EMAIL,
    name: "体验用户",
    password: "demo-not-used",
  });
  demoUserCache = { id: demo.id, email: demo.email, name: demo.name ?? null };
  return demoUserCache;
}

/**
 * Auth gate for REST Route Handlers (主规范 §8 鉴权边界).
 *
 * `app-settings.json` 的 `loginRequired` 是唯一的登录开关（统一配置管理）：
 *   - false（默认，本机单用户模式）：未登录自动回落演示用户，与 tRPC
 *     authedProcedure 的回退一致，不限制「登录才能执行操作」；
 *   - true：无会话返回 null（调用方 401），materials / upload / logs /
 *     llm / custom-nodes / debug 等敏感写入口恢复登录门槛。
 */
export async function requireServerUser(): Promise<ServerUser | null> {
  const session = await getSession();
  if (session?.user?.email) {
    let user = await userRepository.findByEmail(session.user.email);
    user ??= await userRepository.createUser({
      email: session.user.email,
      name: session.user.name ?? null,
      password: "oauth-not-used",
    });
    return { id: user.id, email: user.email, name: user.name ?? null };
  }

  if (!getSettingsSync().loginRequired) {
    return getDemoUser();
  }
  return null;
}

/** 演示用户（无会话时的回退），email 确定性 → 同一 id，进程内缓存避免反复建行。 */
async function getDemoUser(): Promise<ServerUser> {
  if (demoUserCache) return demoUserCache;
  let demo = await userRepository.findByEmail(DEMO_EMAIL);
  demo ??= await userRepository.createUser({
    email: DEMO_EMAIL,
    name: "体验用户",
    password: "demo-not-used",
  });
  demoUserCache = { id: demo.id, email: demo.email, name: demo.name ?? null };
  return demo;
}
