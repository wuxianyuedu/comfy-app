## Added

- **P3 §5 第 2 期 · Phase 3-B1：host 真正接流量（`COMFY_EXECUTOR=host` 才生效，默认 inline 零变化）**：3-B0 打好 host 运行时地基后，这一步把「谁执行」真正接到 `claimedBy` 上。四个已签决定落进代码（记入设计文档 §13-3B1）：
  - **决定 1（执行载荷来源）**：`task` 新增 `execPayload`（json）列——`createQueued` 建行时落**提交时刻**的 `tpl.rawJson`。host 领到行后由 `findExecJob`（impl 第 14 方法：workflowName / execPayload / params）重建 Job，**不经 workflowName 回查模板**（模板被改/删不影响在队任务，可复现性优先）。两处建行入口（tRPC `generate` + 工坊 `workflow-run.server.ts`）同一改动。
  - **决定 4（判据单点 + 打包口径）**：新增 `src/lib/comfyui/executor-mode.ts` 的 `resolveExecutorClaim()` 是「本任务归谁」的唯一定义（读 `COMFY_EXECUTOR`，大小写/空白宽容、未知值 warn 后按 inline）——`generate` / `workflow-run` 用它**同时**决定 `claimedBy` 值与「inline 才进程内 enqueue」。inline 建行也显式写 `claimedBy='inline'`（NULL 只服务历史行）。host 领取循环每 tick `take=1`、默认 2s。
  - **决定 3（取消收尾最小版）**：host tick 的 `reconcileCancelled` 检查在飞 comfy-cli 的 DB 状态，见 `CANCELLED` 就地 kill（三行逐字对齐 `enqueue.cancelTask`）——补上「cli 子进程活在 host 进程、Next 摸不到」那条跨进程取消空窗。完整 `cancelTask` 搬迁仍留 4-B。
  - **host 六 seam 全注入**：`bootRuntime` 补齐 runner/executor-cli/executor-finalize/executor-ws（deps 复用 Next 侧同一份 `client.ts` 的 resolveComfyBase/getView + `core/logger`，均 §18.4 第三类）；领取→重建 Job→`enqueue()` 走与 inline 完全同一条执行链。
- **launcher 的 `COMFY_EXECUTOR` 解析回读 `.env`**（`resolveComfyExecutorMode`）：纯 Node 的 launcher/host 不像 Next 有 `@next/env` 注入，用户把 `COMFY_EXECUTOR=host` 写 `.env` 时——不回读就会「Next 侧建 host 归属行、launcher 却不拉 host」→ 任务停摆。归一化后的值显式回写进 host 子进程 env（防「launcher 认为 host、host 起着骨架」错配）。

## Fixed

- **`--claim-once` 测试钩子**：host 跑恰好一个领取 tick 后 exit（掐掉 enqueue 刚拉起的异步链，测试机不会真带起 ComfyUI）；骨架形态（无 `COMFY_EXECUTOR`）用它是 exit 1 拒绝。契约测据此钉「领取发生 + 行翻 RUNNING + 不碰 inline 行」。

## 测试（新增/改动）

- `repository-task-impl.test.ts`：`findExecJob` 2 条（三列返回 / 未知 id null + execPayload 缺省回 null）。
- `generate.test.ts`：inline 分支补 `claimedBy='inline'` + `execPayload` 落库断言；新增 host 分支（建 host 行 + `enqueue` **不**被调 + execPayload 落库）。
- `executor-mode.test.ts`（新）：判据归一化三组（未设/空→inline、host 大小写空白宽容、非法值 warn 后 inline）。
- `cross-platform-launcher.test.ts`：既有 host 门控测更新到新判据；新增一条断 `spawnExecutorHost` 回写归一化 `COMFY_EXECUTOR` + `resolveComfyExecutorMode` 回读 `.env`（复用 `parseEnvFile`）。
- `tests/executor-host.test.ts`：+2 条 `--claim-once`（host 领一行 QUEUED→RUNNING 且不动 inline 行 / 骨架形态 exit 1 拒绝）。
- `pnpm db:push` 落 `execPayload` 列（`pragma_table_info` 真数确认）。
