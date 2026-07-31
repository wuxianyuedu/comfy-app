import { auth } from "./auth";
import { prisma } from "./db";

export type ServerUser = { id: string; email: string; name: string | null };

const DEMO_EMAIL = process.env.DEMO_USER_EMAIL ?? "demo@comfy.app";

/**
 * Returns the real logged-in user when a session exists; otherwise falls back
 * to a lazily-created demo user so the app keeps working in local single-user
 * mode (and the smoke scripts that hit the API without a cookie keep passing).
 *
 * Separated from `auth.ts` so the edge middleware (which only needs `auth`)
 * never pulls the Prisma client into its bundle.
 */
export async function getServerUser(): Promise<ServerUser> {
  const session = await auth();
  if (session?.user?.email) {
    let user = await prisma.user.findUnique({ where: { email: session.user.email } });
    if (!user) {
      user = await prisma.user.create({
        data: { email: session.user.email, name: session.user.name, passwordHash: "oauth-not-used" },
      });
    }
    return { id: user.id, email: user.email, name: user.name };
  }

  let demo = await prisma.user.findUnique({ where: { email: DEMO_EMAIL } });
  if (!demo) {
    demo = await prisma.user.create({
      data: { email: DEMO_EMAIL, name: "体验用户", passwordHash: "demo-not-used" },
    });
  }
  return { id: demo.id, email: demo.email, name: demo.name };
}
