## Added

- **模块循环依赖成为机器判据（规范 §12.7，`scripts/check-circular-deps.cjs` + 棘轮基线 `scripts/.circular-deps-baseline.json`，接入 pre-commit 第 18 步与 CI）**：`src/lib` 里此前**真实存在 2 组环**，而它们只靠一句注释维持、没有任何测试 ——
  - `comfyui/{executor-cli,executor-finalize,executor-scheduler,executor-ws}.ts`：收口结束要「让队列继续跑」→ import 调度层；调度层要执行任务 → import cli/ws；cli/ws 要结算 → import finalize。四方递归。
  - `comfyui/{client,instance-port,status}.ts`：状态判定要探端口 → import client；client 要按进程快照取地址 → import instance-port；instance-port 要读注册表 → import status。

  判据用**强连通分量（Tarjan）**而不是「找一条环路」：SCC 与遍历起点无关（结果稳定才能做棘轮基线），且天然把「同一个环的不同走法」归成一个分量，不随顺序漂移。基线当前为 **0 组**。
- **`tests/check-circular-deps.test.ts`（13 例）**：把脚本当黑盒跑在临时工作区上 —— 两文件环 / 三文件环 / 自环 / type-only 回引 / `@/` 别名与省略扩展名 / 经 `index.ts` 目录导入 / 注释里的 import 不误报 / `--report` / `--update` 棘轮 / `--strict` 要求收紧，外加两条真实仓库断言（基线为空、当前无环）。

## Changed

- **断环手法与本仓库实例**（规范 §12.7 已写成可照抄的三类）：
  - **下沉叶子模块** —— `probe.ts`（`probeComfyAtPort` / `probeBaseOnce`，只依赖 `fetch` + 地址拼接）、`executor-history.ts`（`fetchHistoryEntry` / `ComfyHistoryEntry` / `traceComfyQueue`）、`redact-secret.ts`、`workflow-node-types.ts`。
  - **依赖倒置（回调注入）** —— 新增 `executor-continuation.ts`：`finalize` / `ws` 只调 `kickQueue()`，调度层在**模块体**里 `registerQueueKick(processQueue)`。注册点必须在模块体（注册要先于任何任务被处理），且缺注册时**不静默空转**（另有 3s 安全网心跳兜底 + 一条 warn）。
  - **共享类型下沉** —— `WorkflowSourceFilter` / `WorkflowModesState` 从宿主 `WorkflowNode.tsx` 下沉到 `workflow-node-types.ts`；`claimSettle` 下沉到状态叶子 `runner-state.ts`（与 `claimFinalize` 同处）。
- **顺带修掉两处「经 barrel 引父件」的环**（同名同源问题）：`ImageGenerationPanel.tsx` 改直接引 `./CanvasNode/CanvasNodePrimitives` 与 `./CanvasNode/ResultCard`，不再经 `CanvasNode/index`（barrel 会 re-export `CanvasNode`，而它又渲染本组件）。
- **日志唯一通道的豁免全部收紧（ISSUE #568 收尾）**：
  - `generation-log.server.ts` 的 `console.warn` 改走 `core/logger`（消息文案不变，额外获得脱敏与 ERROR 镜像 → 面板可见）。
  - `comfyui/trace.ts` 直写文件、不经 pino，因此在**写入边界**过一次值形状守卫 —— 守卫实现从 `server/lib/logger.ts` 抽到 `lib/core/redact-secret.ts`（纯逻辑、零框架依赖），两条通道共用同一份，`server` 侧按原样 re-export。抽出的唯一理由是分层：`lib` 不得 import `server`（§18.3）。
  - `tests/single-logger-channel.test.ts` 的**目录级 `SKIP_DIRS = ["src/lib/comfyui"]` 与逐文件 `ALLOWED` 豁免已删除** —— `comfyui/**` 本就没有 `console` 调用，它真正的缺口是 trace 不经脱敏；目录级豁免的危险在于它让「以后往这里加 `console`」完全无声。新增两例：trace 必须调用共享守卫、`redactSecretShaped` 全仓只有一份实现。

## Fixed

- **`comfyui/trace.ts` 的原始回执此前不经任何脱敏**：该通道把 comfy-cli stdout/stderr 原文、WS 帧、`/history` 与 `/queue` 完整 JSON 直接落盘（单行上限 8000 字符），工作流里的 `apiKey` 类参数、路径上的凭据都会**明文进 `log/comfyui/comfyui-trace.log`** —— 规范 §7.18.2.1 的脱敏契约在这条通道上不成立。现在写入前过一次值形状守卫（PEM / JWT / 高熵串），可见性语义（完整原文、截断上限、失败静默）一律不变。
