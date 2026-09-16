import { createTRPCRouter, authedProcedure } from "~/server/api/trpc";

export const userRouter = createTRPCRouter({
  me: authedProcedure.query(async ({ ctx }) => {
    return {
      id: ctx.user.id,
      email: ctx.user.email,
      name: ctx.user.name,
    };
  }),
});
