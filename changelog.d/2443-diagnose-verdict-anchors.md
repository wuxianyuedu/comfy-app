## Fixed

**`pnpm ship --diagnose` 的失败行只列判据锚（`FAIL` / 超时 / `×`），夹具噪声降级成一句计数**（ISSUE #2443）。

- 当场读数（build `cnb-phl-1k5rscpsg`，格「受影响用例」）：25 条清单里前 12 条是夹具驱动
  `recordSyncFailure()` 时**产品代码自己打的** `[canvas-sync]` 日志（那批用例一条断言都没红，
  那句话本身就是断言对象），接着 8 条 `connect ECONNREFUSED :3000`，而这一跑**唯一**的两条真读数
  （`tests/ci-env-probe.test.ts` 与 `tests/storybook-tsc-input.test.ts` 各自超时）在 L1003 / L1016 ——
  清单按行号排，噪声的数量决定「第一眼看到什么」。
- 根因：抽取只按宽泛错误指纹抓行（`FAIL` / `Error:` 那一族），不区分「运行器**为失败写下的**锚」
  与「被测代码在被测路径上正常打的日志」。含大量 mock 夹具的仓里，后者必然成串出现。
- 改法（`scripts/ci-build-readout.mjs` 的 `stageLogExcerpt`）分两档：日志里有锚
  （`FAIL … > 用例` / `Test timed out in …` / `×` / `AssertionError` / 两份汇总 / `[ELIFECYCLE]`）
  就**只列锚点**，其余带错误字样的行降级成「另有 N 行含错误形状文本，未列出」；
  **没有锚点时保持原口径** —— 构建类格子的 `Error:` 那几行就是唯一证据，降级它们等于把
  「没认出」写成「没有红」。尾部照旧不过滤（它就是「最后那一屏」）。
- 判据：`tests/ci-build-readout.test.ts` 新增一份「噪声按行号排在真读数前面」的夹具（形状照抄
  那一跑），钉住「只列锚点 + 降级计数 + 行号仍是完整日志的行号」，并留一条无锚点的负控制。
- 同一跑里的 `ECONNREFUSED :3000` 家族做了部分归因：探针排除了画布镜像那条链路（它的 fetch 是
  被桩住的、目标是 `127.0.0.1:3100`），机制看清（相对 URL 解析到 happy-dom 默认 origin 的
  `localhost:3000`、请求活过自己那份用例、在 teardown 被 abort）但没钉到文件 ⇒ 转 ISSUE #2458。
