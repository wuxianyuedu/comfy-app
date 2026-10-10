## Added

- **`base-check` 第五态 `load-flake`：时间型判据在 CPU 高负载下的误红不再被读成「别线的红」**（§13.6.4）。现场实测（8 核容器、全量 66 个结构判据 = 钩子 C 组那一批）：8 核空闲 31.9s 全绿；load≈26 时 182.8s 仍全绿；load≈42（4 个 vitest worker 之外再叠 60+ 自旋进程）时 `tests/check-a11y-rules.test.ts` 报 `Test timed out in 30000ms`，而**同一份代码、同一个提交**隔离重跑 4.0s 全绿 —— 红的只是「那一刻机器有多满」。
  - **机制缺口**：四态里没有它，而负载假红**两侧都会红** ⇒ `judge()` 报 `baseline-red`（别线的红）⇒ 照那个动作**把一次调度抖动登记进 `KNOWN_FAILED_FILES`**，下一次它又不红，那条登记从此就是一条会静默失效的账。
  - **修法**：新增 `isTimeoutShaped()`（认 `Test timed out in …` / `Hook timed out in …` / `Failed to start forks worker` / `Timeout waiting for worker to respond` / `Exceeded timeout of …` / `Timeout - Async callback` / 本项目 `超时（Ns）`），`judge()` 在**两侧都红且两侧输出都是超时形态**时报 `load-flake`；只在单侧超时形态**不**降这一档（那更像「你的改动让它变慢了」，归 `yours`）；`inconclusive` 仍压过它。整批优先级：`inconclusive` > `yours` > `load-flake` > `baseline-red`。
  - **⚠️ 指纹不是结论**：真回归也可能恰好卡在超时上，所以 `load-flake` **不许**当放行依据 —— 放行由隔离复跑（`--no-file-parallelism`）的结论定。这一态**不许**抬 `testTimeout`、**不许**登记 `KNOWN_FAILED_FILES`（§11.13「看到 60s 都超时不要改成 120s」同款口径）。
  - 同批：`premerge-check` 的折算把 `load-flake` 收进「其余 = 1」（合并前一跳要的是「干净」，折成 0 等于让一次超时假红放行一次合并），并把这条口径写进那一处注释；`base-check` 的批量档此前**丢掉了本检出那一侧的输出**（只在 `judge()` 那一次调用里传一下就丢），所以这一档在 `--base` 那一批里根本判不出来 —— 两份输出现在都落进行里。
  - 用例 +11（`tests/base-check.test.ts` 37 → 48）：五态各一组、只在单侧超时的负控制、真断言红的假阳性闸、指纹表两向（本仓库真见过的原文命中 / 真断言输出不命中）、整批两种优先级、`load-flake` 的下一步话术点名「先隔离复跑」且不许照 `baseline-red` 处置。
