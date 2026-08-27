import { z } from "zod";

import {
  createTRPCRouter,
  authedProcedure,
} from "~/server/api/trpc";
import { prisma } from "@/lib/db";

export const postRouter = createTRPCRouter({
  // R-T3-phase4 (OWASP A01): demo scaffold query no longer public — list/read
  // endpoints require an authed (or local demo) user.
  getLatest: authedProcedure.query(async () => {
    const post = await prisma.post.findFirst({
      orderBy: { createdAt: "desc" },
    });
    return post ?? null;
  }),

  create: authedProcedure
    .input(z.object({ name: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const post = await prisma.post.create({
        data: { name: input.name, createdById: ctx.user.id },
      });
      return post;
    }),

  getSecretMessage: authedProcedure.query(() => {
    return "you can now see this secret message!";
  }),
});