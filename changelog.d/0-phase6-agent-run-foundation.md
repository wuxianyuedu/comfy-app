## Added

- **AI 自主执行的 run 协调层（Phase 6 地基 / 本 PR 零执行行为变更）**：给「AI 把整条流水线（剧本→角色→分镜→生图→视频→成片）自主跑到底、用户可在画布/工坊随时干预」这套模型打下数据与控制地基。
  - `production` 新增 `run` JSON 列（与 `progress` 一样是两侧共读的持久态，但**由 run 控制端点单独写**、不进工坊自动保存载荷 —— 字段所有权，避免工坊每次保存覆盖 AI 的 run）。`test-db` 同步（CREATE_SQL + jsonColumns）。
  - 纯逻辑 `src/lib/production/run-types.ts`：`ProductionRun`（生命周期 `idle|running|awaiting_approval|paused|done|failed|cancelled` + 审批粒度 `ApprovalMode auto|stage|shot`，默认 `stage` + 每镜「已处理 rev 快照」）、`normalizeProductionRun`、`toRunView`、以及**规划器** `planNextRunAction` —— 每步重读当前 production 视图，找第一个未完成步骤；某镜「无图」或「被本 run 处理过、其 rev 又变新（用户改过/退回）」才纳入待办，**基于用户改后的内容续跑、绝不覆盖手改**。`仓储` 加 `updateRun`（只写 run 列）。
  - tRPC `run` 路由（authed）：`start / pause / resume / approve / cancel / status`。`status` 用规划器回显「下一步动作」，供画布 / 工坊两块操纵台读取渲染。本 PR 只落**状态与只读规划**，真正按动作执行（调 LLM 阶段 / 提交 ComfyUI 生图任务 / 复用 `render` 管线）在服务端引擎里消费同一套 run + planner（P6-2）。

## 说明

设计取向：既然要「在画布干预时 AI 还在跑」，自主循环不能待在切视图即卸载的工坊 agent 里 —— 故 run 落服务端、两视图只是它的操纵台。默认「每阶段点头」、干预语义「按模式混合」已与需求方确认（可切全自动 / 逐张）。
