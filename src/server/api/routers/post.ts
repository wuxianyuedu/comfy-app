import { z } from "zod";

import { createTRPCRouter, authedProcedure } from "~/server/api/trpc";
import { db } from "@/lib/db";
import { post, type Post } from "~/server/db/schema";
import { desc } from "drizzle-orm";

export const postRouter = createTRPCRouter({
  // R-T3-phase4 (OWASP A01): demo scaffold query no longer public — list/read
  // endpoints require an authed (or local demo) user.
  getLatest: authedProcedure.query(async (): Promise<Post | null> => {
    const rows = await db.select().from(post).orderBy(desc(post.createdAt)).limit(1);
    return rows[0] ?? null;
  }),

  create: authedProcedure
    .input(z.object({ name: z.string().min(1) }))
    .mutation(async ({ ctx, input }): Promise<Post> => {
      const rows = await db
        .insert(post)
        .values({ name: input.name, createdById: ctx.user.id })
        .returning();
      return rows[0]!;
    }),

  getSecretMessage: authedProcedure.query(() => {
    return "you can now see this secret message!";
  }),
});
