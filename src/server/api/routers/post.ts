import { z } from "zod";

import { createTRPCRouter, authedProcedure } from "~/server/api/trpc";
import { type Post } from "~/server/db/schema";
import { postRepository } from "@/lib/core/repository";

export const postRouter = createTRPCRouter({
  // R-T3-phase4 (OWASP A01): demo scaffold query no longer public — list/read
  // endpoints require an authed (or local demo) user.
  getLatest: authedProcedure.query(async (): Promise<Post | null> => {
    return postRepository.getLatest();
  }),

  create: authedProcedure
    .input(z.object({ name: z.string().min(1) }))
    .mutation(async ({ ctx, input }): Promise<Post> => {
      return postRepository.create({ name: input.name, createdById: ctx.user.id });
    }),

  getSecretMessage: authedProcedure.query(() => {
    return "you can now see this secret message!";
  }),
});
