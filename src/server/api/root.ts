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

/**
 * 这是服务端的主路由。
 *
 * 在 /api/routers 下新增的路由都要在这里手工登记。
 *
 * **登记即欠两样东西**：这里每挂一个命名空间，`tests/trpc-surface-executors.test.ts`
 * 就要求它的每一条 procedure
 *  · **有执行者** —— 能在某份测试里被真正调用到（挂载点与执行者之间的断层是本台账 E3
 *    一路在补的东西：`post` / `user` / `customNode` 三个零消费、零执行的脚手架口就是
 *    被这条判据照出来的，随批删除）；
 *  · **有消费方** —— 能在界面 / 客户端 / 服务端代码里找到一处真用它的人，找不到就必须
 *    进 `tests/trpc-surface-executors.test.ts` 的 `ZERO_CONSUMER` 清单并写明原因（台账 E3′）。
 *
 * 一个口「能调通」与「有人在调」是两件事：前者由执行者保证，后者由消费方保证。
 * `material.*` 就是因为只有前者、没有后者而删掉的 —— 它与 `src/app/api/materials/route.ts`
 * 是同一套归属判据的两扇门，而界面只走 REST 那扇。**别再为素材库补第二扇 tRPC 门。**
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
});

// 对外导出 API 的类型定义
export type AppRouter = typeof appRouter;

export const createCaller = createCallerFactory(appRouter);
