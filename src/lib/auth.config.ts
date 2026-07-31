import NextAuth from "next-auth";
import type { NextAuthConfig, DefaultSession } from "next-auth";

// Edge-safe config: NO prisma / bcrypt / Credentials provider here, so it can
// be imported from middleware.ts (edge runtime) without pulling the Prisma
// wasm client into the edge bundle. JWT session decoding only needs the
// secret + strategy, which this provides.
export const authConfig = {
  trustHost: true,
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  // Edge-safe: no DB-backed provider here. The full instance in auth.ts
  // overrides this with the Credentials provider.
  providers: [],
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        (token as Record<string, unknown>).id = (user as { id: string }).id;
        token.email = user.email;
        token.name = user.name ?? null;
      }
      return token;
    },
    session({ session, token }) {
      if (session.user) {
        const t = token as { id?: string; email?: string; name?: string | null };
        session.user.id = t.id ?? session.user.id;
        session.user.email = t.email ?? session.user.email;
        session.user.name = t.name ?? session.user.name;
      }
      return session;
    },
  },
} satisfies NextAuthConfig;

// Edge-safe NextAuth wrapper (decodes the JWT session cookie; no provider/db).
// Used by middleware.ts. Shares AUTH_SECRET with the full instance in auth.ts,
// so the session cookie is mutually readable.
export const { auth } = NextAuth(authConfig);

// ── Shared type augmentations ────────────────────────────────
declare module "next-auth" {
  interface Session {
    user: { id: string } & DefaultSession["user"];
  }
}
