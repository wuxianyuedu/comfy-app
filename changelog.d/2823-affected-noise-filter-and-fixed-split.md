## Fixed

- **受影响用例门的 CI 日志被被测源码自己的 `console.error` 淹没**（ISSUE #2823）。
  canvas-sync 的 `TRPCClientError` / `ECONNREFUSED`（开发服务器 ：3000 连接拒绝）、
  a11y 用例故意渲染的错误边界——这些噪音 `--reporter=dot` 压不掉（它只管 vitest
  自己的进度输出，管不了被测源码打的字）。新增 `COMFY_AFFECTED_NOISE_FILTER=1`
  （仅 `.cnb.yml` 受影响用例 stage 置位）：`spawnVitest` 抓到输出后、回吐给平台前
  按行过滤良性噪音（`scripts/affected-launch-noise-reporter.mjs`），**判据取数面
  `output` 用同一份过滤结果**——噪音清单里不含任何指纹文本，超时 / 装载判决不受影响。
  本地不置该变量 ⇒ 逐字回吐，开发者照常看到全部日志。

## Changed

- **受影响用例把「固定结构用例」与「其余受影响用例」分开成块执行**
  （ISSUE #2823）：`planSeparatedLaunches()` 按既有 `FIXED_STRUCTURAL_TESTS` 清单把
  `collectList()` 拼出的 files 拆成「固定 / 受影响」两段、各自按命令行预算分块，
  日志抬头带 `[fixed]` / `[affected]` 标签，谁的账读得出来；成员与顺序不重排，
  固定段排前。`planLaunches()` 原签名与行为不变（既有分块用例照旧钉着它）。
