## Fixed

- **每日档「单元测试」把「子进程被信号打死」念成「在墙钟预算处被砍」**（ISSUE #3332）：
  GA Daily (mirror) run 42364056027 的现场——子进程只活了 3m07s（30 分钟预算从未到），
  死前 3793 条用例全绿、死在覆盖率报告收尾段，读数 `退出码 信号，error=无`。真预算砍
  会带 `error=ETIMEDOUT`（spawnSync 超时的形状）；`error` 不在而 `signal` 在是被外击
  （OOM killer / 杀树）。`classifyOutcome` 早就分得开这两种收场，但消费端把不同成因
  共用同一句 `abortedAdvice` 话术，且 `runPnpmSync` 丢弃了 `result.signal`，读数永远
  打不出「被什么杀」。
- 修法三件同批：① `runPnpmSync` 返回形状带出 `signal`（`result.signal ?? null`）；
  ② `abortedAdvice` 按三态分话术——`ETIMEDOUT` = 预算砍（原句保留）、其余 `error` =
  「压根没起来」（查落点与参数形态）、`signal` = 「被信号打死」（下一动作改为先取内核
  证据定性再复跑整档），不带新参时保持预算话术（兼容既有调用方）；③ `full-suite-run`
  与 `artifact-run` 两个消费方把 `signal` / `errorCode` 原值带进去，读数行改为
  `退出码 无，信号 <名>，error=<code|无>`。
- `tests/daily-tracks.test.ts` 新增 2 条：三态话术各归各位（信号杀不许再念「预算砍」）、
  两个消费方真的把读数原值带进话术且 `runPnpmSync` 不再丢 `signal`。
