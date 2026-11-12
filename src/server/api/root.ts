import { createTRPCRouter, createCallerFactory } from "~/server/api/trpc";
import { projectRouter } from "~/server/api/routers/project";
import { taskRouter } from "~/server/api/routers/task";
import { filmRouter } from "~/server/api/routers/film";
import { workflowRouter } from "~/server/api/routers/workflow";
import { modelRouter } from "~/server/api/routers/model";
import { skillRouter } from "~/server/api/routers/skill";
import { llmRouter } from "~/server/api/routers/llm";
import { settingRouter } from "~/server/api/routers/setting";
import { workflowModelRouter } from "~/server/api/routers/workflow-model";
import { generateRouter } from "~/server/api/routers/generate";
import { runRouter } from "~/server/api/routers/run";
import { seriesRouter } from "~/server/api/routers/series";
import { seriesGenerationRouter } from "~/server/api/routers/series-generation";
import { sidebarRouter } from "~/server/api/routers/sidebar";

/**
 * 服务端主路由：`/api/routers` 新增路由须在此手工登记，登记即欠「执行者」（测试能真调用，E3 照出
 * `post`/`user`/`customNode` 零消费脚手架口）与「消费方」（至少一处真用它，否则进 `ZERO_CONSUMER` 并写明原因）。
 * 能调通≠有人在调：`material.*` 只有前者被删 —— 界面对素材库只走 REST 那扇门，别再补第二扇 tRPC。
 */
export const appRouter = createTRPCRouter({
  project: projectRouter,
  task: taskRouter,
  film: filmRouter,
  workflow: workflowRouter,
  model: modelRouter,
  skill: skillRouter,
  llm: llmRouter,
  setting: settingRouter,
  workflowModel: workflowModelRouter,
  generate: generateRouter,
  run: runRouter,
  series: seriesRouter,
  seriesGeneration: seriesGenerationRouter,
  sidebar: sidebarRouter,
});

// 对外导出 API 的类型定义
export type AppRouter = typeof appRouter;

export const createCaller = createCallerFactory(appRouter);
