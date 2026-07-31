import { prisma } from "./db";

// MVP/dev helper: returns a stable demo user so the generate flow works before
// the real Auth.js login (M4) is wired. Replaced by getServerSession() in M4.
const DEMO_EMAIL = process.env.DEMO_USER_EMAIL ?? "demo@comfy.app";

export type ServerUser = {
  id: string;
  email: string;
  name: string | null;
};

export async function getServerUser(): Promise<ServerUser> {
  let user = await prisma.user.findUnique({ where: { email: DEMO_EMAIL } });
  if (!user) {
    user = await prisma.user.create({
      data: {
        email: DEMO_EMAIL,
        name: "体验用户",
        passwordHash: "demo-not-used",
      },
    });
  }
  return { id: user.id, email: user.email, name: user.name };
}
