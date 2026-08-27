import { createTRPCRouter, createCallerFactory } from "~/server/api/trpc";
import { postRouter } from "~/server/api/routers/post";
import { userRouter } from "~/server/api/routers/user";
import { projectRouter } from "~/server/api/routers/project";
import { taskRouter } from "~/server/api/routers/task";
import { filmRouter } from "~/server/api/routers/film";
import { workflowRouter } from "~/server/api/routers/workflow";
import { trainRouter } from "~/server/api/routers/train";
import { modelRouter } from "~/server/api/routers/model";
import { skillRouter } from "~/server/api/routers/skill";
import { llmRouter } from "~/server/api/routers/llm";
import { settingRouter } from "~/server/api/routers/setting";
import { materialRouter } from "~/server/api/routers/material";
import { workflowModelRouter } from "~/server/api/routers/workflow-model";
import { customNodeRouter } from "~/server/api/routers/custom-nodes";
import { generateRouter } from "~/server/api/routers/generate";

/**
 * This is the primary router for your server.
 *
 * All routers added in /api/routers should be manually added here.
 */
export const appRouter = createTRPCRouter({
  post: postRouter,
  user: userRouter,
  project: projectRouter,
  task: taskRouter,
  film: filmRouter,
  workflow: workflowRouter,
  train: trainRouter,
  model: modelRouter,
  skill: skillRouter,
  llm: llmRouter,
  setting: settingRouter,
  material: materialRouter,
  workflowModel: workflowModelRouter,
  customNode: customNodeRouter,
  generate: generateRouter,
});

// export type definition of API
export type AppRouter = typeof appRouter;

export const createCaller = createCallerFactory(appRouter);