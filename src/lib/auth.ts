import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { authConfig } from "./auth.config";

// Full config (Node runtime only): adds the Credentials provider whose
// `authorize` touches the DB. Imported by route handlers / server components,
// NOT by middleware (which uses auth.config.ts to stay edge-safe).
export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      name: "邮箱密码",
      credentials: {
        email: { label: "邮箱", type: "email" },
        password: { label: "密码", type: "password" },
      },
      async authorize(credentials) {
        const email = String(credentials?.email ?? "").trim().toLowerCase();
        const password = String(credentials?.password ?? "");
        if (!email || !password) return null;
        // Lazy imports keep these out of any edge/middleware bundle.
        const { prisma } = await import("@/lib/db");
        const bcrypt = (await import("bcryptjs")).default;
        const user = await prisma.user.findUnique({ where: { email } });
        if (!user) return null;
        const ok = await bcrypt.compare(password, user.passwordHash);
        if (!ok) return null;
        return { id: user.id, email: user.email, name: user.name ?? null };
      },
    }),
  ],
});
