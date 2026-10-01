import { createTRPCRouter, createCallerFactory } from "~/server/api/trpc";
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
import { generateRouter } from "~/server/api/routers/generate";
import { runRouter } from "~/server/api/routers/run";

/**
 * 这是服务端的主路由。
 *
 * 在 /api/routers 下新增的路由都要在这里手工登记。
 *
 * **登记即欠一个执行者**：这里每挂一个命名空间，`tests/trpc-surface-executors.test.ts`
 * 就要求它的每一条 procedure 都能在某份测试里被真正调用到（挂载点与执行者之间的
 * 断层是本台账 E3 一路在补的东西：`post` / `user` / `customNode` 三个零消费、零执行
 * 的脚手架口就是被这条判据照出来的，随批删除）。
 */
export const appRouter = createTRPCRouter({
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
  generate: generateRouter,
  run: runRouter,
});

// 对外导出 API 的类型定义
export type AppRouter = typeof appRouter;

export const createCaller = createCallerFactory(appRouter);
