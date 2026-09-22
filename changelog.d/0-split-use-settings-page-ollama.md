## Changed

- **`src/app/(main)/settings/hooks/use-settings-page.ts` 抽第三个 sub-hook（Ollama）**：
  PR-33 抽了 AppUpdate + DbStudio 两组后主文件 966 行；本轮把 Ollama 那一整块
  沉到 **`./use-settings-page-ollama`**（194 行）：`status` / `models` /
  `starting` / `stopping` 四条 state + `startingRef` / `stoppingRef` 两把
  跨事件循环持有权锁 + 两个探测（`probeOllamaSilent` / `probeOllama`）+
  provider/baseUrl 挂载 effect + `startOllama`（`OLLAMA_READY` 退避轮询等
  就绪）+ `stopOllama`（终止进程树 + 重探一次）+ 运行时日志 active 判据。
  baseUrl 与 provider 是否本地由主 hook 从 `llmDraft` 里取出传入，sub-hook
  不碰草稿的编辑与持久化——那是主 hook 的边界。返回形状逐字段等价于原控制
  器（`ollamaStatus` / `ollamaModels` / `ollamaStarting` / `ollamaStopping`
  / `ollamaLog` / `startOllama` / `stopOllama`），主 hook 一次解构，
  消费者 `from "./hooks/use-settings-page"` 的路径**完全不变**。

  顺带清掉一段**只写不读**的死代码：`ollamaStatusRef` 及其 `useEffect`
  同步——原本注释说「轮询里要读最新状态」，但整块代码里从来没读过它，
  是 PR-33 之前那次状态精简留下的漏项；一并删。

  主 hook 相关的 8 个顶层 import 随拆包变无消费方：`sleep`（拉起轮询用的），
  `parseOllamaLogText`（Ollama 日志的 ANSI→level 上色），`probeOllamaClient`
  / `startOllamaClient` / `stopOllamaClient` / `OllamaModel`（ollama-client
  一族），`OLLAMA_READY`（retry-policy），`OllamaStatus` 类型；一并从主
  文件移除，同时删掉本地 `OLLAMA_START_POLL_TIMES` /
  `OLLAMA_START_POLL_INTERVAL_MS` 两个模块常量（它们只是把 `OLLAMA_READY`
  别名一层，sub-hook 里直接用 `OLLAMA_READY.maxAttempts` / `.baseMs`）。

  主文件 966 → 837 行（-129 / -13%）。**关键**：`check-file-structure --strict --update`
  报「0 个超限文件」——本轮技术债盘点里的 6 个 R5 违规文件（workflow-detail-raw /
  workflow-subgraph-parse / workflow-param-mapping / use-settings-page / log-store /
  LogPanel / workflow-io）全部拆到 900 行阈值以下，`.file-size-baseline.json`
  从此是**空数组**（total 0）。tsc 绿；`src/app/(main)/settings/**` 5 测试
  文件 67 用例全过；`check-circular-deps` 无新增环（sub-hook 单向依赖 lib +
  类型叶子）。

## Added

- `scripts/.file-size-baseline.json` 里 `baselineRev` 更新到 `8154d954`
  （PR-33 的 squash-merge 提交），从此 R5 基线是**空**——下一份新文件只要
  不越过 900 行，就不会进这个清单。真越过时会直接以「新增超限文件」的形式
  阻断，逼作者当场拆。
