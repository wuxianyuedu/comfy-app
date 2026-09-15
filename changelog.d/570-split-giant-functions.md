## Changed

- **`src/lib` 巨型函数按「策略注入 + 具名纯函数」拆分（ISSUE #570 第 1~6 项）。** `comfyui/lifecycle.ts` 的 `ensureComfyUiReady`（405 行，内含 288 行 IIFE 与三个不可测回调）与 `comfyui/executor-cli.ts` 的 `executeViaComfyCli`（473 行）不再挤在单个函数里：
  - 新增 `src/lib/comfyui/lifecycle-wait.ts`：`waitForComfyReady(opts)` 把「拉起 → 等待就绪 → 判死 → 超时收尾」收敛成**一份循环**，keepAlive 与 bound 两条路径只注入 `probe` / `isDead` / `earlyExit`，超时文案从两处逐字重复收敛到一处；`createOutputSink` / `createRecentOutputLedger` / `createChildExitHandler` 把事件回调改为显式传参的具名函数，取消留底与截断行为无需真子进程即可断言。
  - 新增 `src/lib/comfyui/executor-cli-stream.ts`：`createCliEnvelopeParser`（stdout 按行聚合 envelope + 事件分发）、`createCliStderrSink`（噪声过滤 / 限行 / 完整留底）、`createCliFinisher`（envelope 收口 + 结构化校验错误落日志）从 240 行内联闭包里拆出；`findNodeErrorsCarrier` 的深搜逻辑随之显式化。面板 `log` 与成功/失败收口经参数注入（直接 import 会经 `core/repository` 拖进 DB，使这些函数无法脱离 `.env` 单测）。
  - `comfyui/workflow-detail.ts`：278 行 `cacheJson` 闭包提为具名 `buildWorkflowDetailJson(input)`，闭包体与外层缩进脱节的问题随之消失。
  - `drizzle-studio/lifecycle.ts`：80 行 IIFE 复用同一套等待原语与输出回调，不再各写一遍轮询与留底。
  - 函数长度棘轮基线随之收紧：22 → 20（`lifecycle.ts` / `executor-cli.ts` 各减少 1 个 400 行以上函数）。

## Added

- `src/lib/comfyui/lifecycle-wait.test.ts`（10 例）与 `src/lib/comfyui/executor-cli-stream.test.ts`（16 例）：钉住等待循环的就绪 / 判死 / 早退 / 超时四态、输出截断与留底上限、stderr 噪声过滤与限行、envelope 深搜与收口幂等。
