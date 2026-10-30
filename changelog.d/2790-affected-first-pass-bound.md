## Fixed

- **「受影响用例」的第一遍也要有上界**——PR #2760 的 `curly` 批量化（1158 个文件）把改动面经反向 import 闭包放大成 808 份 / 11443 条，首跑并发被 `ci-load.mjs` 折到 1，于是第一遍自己吃了 54 分钟被平台 `timeout: 45m` 掐断（`cnb-l0u-1k66agmv9`）。最坏的不是慢，是那一屏**一条用例名都没有**：`--reporter=dot` 在第一份跑完之前只往同一行打点，平台保留的又是日志尾部。根因是两条判据的判点都划在错的一侧：`STAGE_WALL_CLOCK_MS`（25 分钟）判的是「还开不开第 2 遍」，而第一遍在它之前；`spawnVitest` 不给 `timeout`，第一遍**没有任何上界**。
- 修法两件，各自成立且都落在「没判」这一档（退 2，不是红也不是绿，§13.6.2）：① 新增 `gateFirstPassByWallClock`，按「份数 × 单份实测单价」判这一遍合不合得进来——单价取已跑完各块的实测值，拿不到就不拦（「不知道」不构成阻断理由），刻意不用常数界；② `spawnVitest` 认 `timeout`，掐断后打一份可读的收场（预算用尽 / 退 2 / 两条下一动作：拆开改动 或 `--full`），`timedOut` 与 `signal` 一起回吐给既有判决链，不把「没跑完」读成「跑完了但退出码怪」。
- 收尾账同步新增 `budget-killed` 一档（比 `budget-skipped` 更彻底：后者是「没开第 2 遍」，这里是「第 1 遍没跑完」），措辞不许含糊成「跑完了」。判据 `tests/hook-affected-launch.test.ts` 新增三条钉住「按份数 × 单价判 / 三个『不知道』都不拦 / 那句话必须说未判定并给两条出口」，并修了两条因函数签名与调用形状变化而会**静默取不到**的源码文本判据。

  > **这是「装不下」，不是「有回归」**：同一份 808 份在本机空机上默认并发 **597.6s 跑完**，12 份失败全是 `isSameVolume("G:\\a","C:\\b")` 这一类 Windows 盘符断言在 Linux 上的平台形态，同一批在 `master` 上同样红 —— 与 `curly` 无关。

- **顺带修掉 `curly` 批量化带出的 6 份源码契约用例**（它们断言的是「不带花括号的单语句体」这一排版形态，本 PR 的 `eslint/curly` 把那些行改成了 `if (…) { … }`）：`app-port-vectors-timeout-classification`（2 条）、`app-service-exit-contract`、`ci-cp936-glyphs`、`ci-toolchain-selfcheck`（`.replace` 锚点没命中，被它自己那段「三处各自判一次」抓出来）、`film-resume-startup-point`。判据内容一个字没放宽——改的是「认条件 + 紧随其后的语句」而不是「认它写在一行」。这 5 份在 `master`（`8d118946`）上实测全绿，是本批引入的回归。
- `check-format.test.ts` 那两条「本地那一档（没有平台旗标）」**真的**没有平台旗标了：在 CNB 构建容器 / NPC 工作区里跑时，`CNB_PULL_REQUEST_TARGET_SHA` 躺在继承环境里，于是那一格拿到的是上一个 PR 的目标 sha、进而去问本仓对象库要那个提交（实测报 `改动面没算出来：8d118946… 的 diff 没跑起来`）。现在显式删掉它——夹具本来就支持 `{ env: { KEY: undefined } }` 这档，只是这条用例没用到。
