## Added

- **服务端 run 执行引擎（Phase 6 · P6-2）**：接 P6-1 的 run + 规划器，让 AI **自主把整条流水线跑到成片**（含生图），用户可在画布/工坊随时干预、AI 基于改后内容续跑。
  - `src/server/agent/run-engine.ts` 的 `advanceRunLoop(userId, projectId)`：一次推进到下一个**停点**（等点头 / 完成 / 失败 / 被暂停）。每一步**从库里重读 `production` + run** 再决策，因此：用户点「暂停/取消」→ 下一 tick 见 `status≠running` 即让位；用户改了某镜（`rev` 变新）→ 规划器把它重新纳入待办、只重做该镜、**不覆盖手改**。放在服务端（而非切视图即卸载的工坊 agent）正是为了「边干预边跑」。
  - 执行器（均写回走 `patchContent`，不碰 run/progress 列，守字段所有权）：剧本/角色/分镜用 `completeLLM`/`completeLLMStructured` 产出后写 `production`；逐镜生图用 `synthesizeFirstFrame`（图类工作流）填 `shot.imageUrl`；出片复用 `renderProjectFilm`（`createFromProject→start`，服务端逐镜视频 + 合成 + `syncFilmToProject` 回写），以 `filmStartedAt` 标记只起一次、之后等 `rendered`。
  - 审批门：`approvalMode≠auto` 时，每完成一步落 `awaiting_approval`（带 `awaitingStage`）并停；`auto` 一路到 `done`。引擎自带异常兜底，失败落 `failed` 带原因，绝不抛给 fire-and-forget 调用方。
  - `production` 仓储加 `patchContent`（只更 scriptMarkdown/characters/shots）；`ProductionRun` 加 `imageWorkflowId/videoWorkflowId/filmStartedAt`；`run.start` 接收工作流 id 存进 run；`run.start/resume/approve` 在置 `running` 后 fire-and-forget 拉起 `advanceRunLoop`。

## 说明

循环控制（计划→执行→写回→审批/暂停/字段所有权/失败）以 mock 单测覆盖（真实 `productionRepository` + 内存 test-db，mock LLM/生图/出片）。模型与 ComfyUI 的端到端真实产出需在有模型/ComfyUI 的环境另行验证。下一步 P6-3：画布/工坊两块操纵台（暂停/继续/点头横幅、单镜「退回让 AI 重做」= rev+1 写入点、审批粒度设置）。
