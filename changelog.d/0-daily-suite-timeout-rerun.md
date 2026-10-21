## Added

- **`scripts/full-suite-run.mjs`（`每日单元测试` 那一格的执行者）现在自带超时指纹的隔离复跑**。
  这一档此前只有组 C 有（§13.6.4.1），每日那一跑没有 —— 于是「一份文件排不上调度」在每日链上
  长得和「代码回归了」一模一样。触发事实 `cnb-b0l-1k59op66t`：`tests/deps-freshness-gate.test.ts:166`
  一条 `Test timed out in 30000ms`、**没有任何断言报错**，就把后面的
  `每日生产构建` / `每日浏览器安装` / `每日全量E2E` 三格全部 skip 掉。
- **判决链不在这里重写**（§12.12 / §12.18）：指纹清单、等机器喘口气、argv 长预算的分块，
  全部 import 组 C 那三份模块（`affected-launch-load-retry.mjs` 的 `isTimeoutShaped` /
  `waitForLoadToSettle`、`run-affected-tests.mjs` 的 `planLaunches`、
  `precommit-timing.mjs` 的 `failingSuitesFromJunit`）—— 两份超时正则各自长一份就是漂移的开始，
  而那条漂移已有用例钉着（`tests/hook-affected-launch.test.ts` 逐条核对清单不叉开）。
  本文件新增的三个出口是纯函数，档位表可以直接被用例钉：
  `planIsolatedRerun`（跑不跑、跑哪几份）、`classifyRerunOutcome`（第 2 遍的三态）、
  `rerunLaunches`（复跑的命令行）。
- **四档行为，逐条都有判据**：
  | 第一跑的形态 | 动作 |
  | --- | --- |
  | 绿 | 不复跑 |
  | 红、**不带**超时指纹 | **一次都不复跑**，真红照拦（这一格最该守住 —— 放走真红等于把每日档变成没有判据） |
  | 红、带指纹、读得出名单 | 只串行复跑那几份 |
  | 红、带指纹、读不出名单 | **退回整档**（方向单边化：漏跑一份真失败的文件比多跑一批绿文件贵得多） |
  第 2 遍再分三态：绿 ⇒ `load-flake`（负载假红，退 0）；仍带指纹 ⇒ `unverified`
  （**不是绿也不是红**，退 0 但逐条点名「哪些文件本次没被校验」）；指纹消失 ⇒ `real-red`（照拦，
  并把第 2 遍输出尾部贴出来 —— 串行那一份读数才是该看的现场）。
- **三条刻意没做的事，写清楚免得被误读**：
  1. **不抬任何预算** —— 降负载的手段只有并发（`--no-file-parallelism`），
     `testTimeout` 一个字节没动；复跑自己的墙钟预算 `RERUN_TIMEOUT_MS` 还**严格小于**整档那一跑
     （允许它等于整档就等于把这一格变成第二次全量）。
  2. **复跑不带 `--coverage`** —— 覆盖率门槛判的是整档的分子分母，拿子集跑必然跌破门槛，
     那只会把「负载假红」换成一条**新的假红**。
  3. **两种放行都不记账** —— 这条账的语义是「整档带门槛跑绿过」；负载假红与未校验都不是那件事
     （§13.6.2 的 `inconclusive` 同口径：拿不到测量 ≠ 测量结果是绿的，ISSUE #1747）。
  ⚠️ `main` 因此从同步改成 `async`（`waitForLoadToSettle` 是真等待，同步 `Atomics.wait`
  会让日志看着像挂死），调用点相应改成 `process.exit(await main(...))` —— 与
  `run-affected-tests.mjs` 同一形态。
- 判据：`tests/daily-tracks.test.ts` 新增 8 条（上面那张表的四行 + 三态各一 + 命令行形状 +
  预算严格小于 + 「脚本里不许出现第二份超时正则」的形状判据）。其中「不带指纹不复跑」那条
  带一句**反向复算**：同一份 fixture 把读数换成带指纹的，结论当场变成复跑 —— 否则
  「不复跑」可能只是判据没接上（恒 false）而不是判对了。
- 规范同批：§13.5 那张「谁在跑这一格」的表里，全量单测那一行补上这一档与触发事实；
  `docs/generated/13` 随 `pnpm doc:render` 一起更新。
- 复算：`pnpm exec tsc --noEmit` 退 0（改的过程中它先拦下三条：一个 import 没用、
  `main` 的参数在异步化后失去推断、reduce 初值与累加器类型不一致 —— 都是当场修的，
  没留给平台）；`pnpm exec eslint` 两份文件退 0；`vitest run tests/daily-tracks.test.ts`
  64 条全绿（新增 8 条）；`node scripts/full-suite-run.mjs --dry-run` 结论一字未变
  （证明这一改动没有动第一跑的命令行）；`check-infra-file-size` 243 份文件超 900 行 0 个
  （本文件 705 行）；`pnpm doc:check` 退 0，改过那一行按竖线数复量仍是 3 列。
