import { getSession } from "~/server/better-auth/server";
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
