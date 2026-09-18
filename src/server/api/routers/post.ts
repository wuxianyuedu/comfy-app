import { z } from "zod";

import { createTRPCRouter, authedProcedure } from "~/server/api/trpc";
import { type Post } from "~/server/db/schema";
import { postRepository } from "~/lib/core/repository";

export const postRouter = createTRPCRouter({
  // OWASP A01（越权访问）：脚手架留下的示例查询不再公开 ——
  // 列表与读取接口都要求已登录用户（或本地演示态）。
  getLatest: authedProcedure.query(async (): Promise<Post | null> => {
    return postRepository.getLatest();
  }),

  create: authedProcedure
    .input(z.object({ name: z.string().min(1) }))
    .mutation(async ({ ctx, input }): Promise<Post> => {
      return postRepository.create({
        name: input.name,
        createdById: ctx.user.id,
      });
    }),

  getSecretMessage: authedProcedure.query(() => {
    return "you can now see this secret message!";
  }),
});
