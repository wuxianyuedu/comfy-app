## Fixed

- **GA 每日档跑红不再「静默不立案」**（#3563）。`失败立案` 从 `daily` job 内部的一个
  step 挪成**下游 job** `daily-failure-issue`（`needs: daily` + `if: failure()` +
  `continue-on-error: true`），判决脚本与去重键一个字未改。

  根因：脚本唯一的红格来源是 jobs API 的 `steps[].conclusion === "failure"`，而它作为
  step 跑在 `daily` 内部时那个 job 自己还是 `in_progress` —— 实测读回 **0 个红格**
  （run `42915112854`：`单元测试` 22:39:17 判 failure，立案步 22:39:17→22:39:19 就跑了，
  打印「红格 0 个」⇒ 零写入，退码 2 被 `--no-block` 折成 0）。于是「红了没立案」与
  「今天没红」在账上逐字同形。配置与脚本注释里原先写的「jobs API 此时已把前面红格的
  conclusion 写好」是**未经复核的前提**，已被那一跑推翻；本次同批订正了全部复述点
  （`daily.yml` 头注与 step 注释、脚本文件头与 `failedStepsFromJobs` 的 docstring、
  `.cnb.yml` 退役说明里的「step」字样、`tests/no-platform-ci-config.test.ts` 退役登记
  `每日失败立案` 那条 note 里的「末尾的 step」→「下游 job」）。

  挪到下游之后上游已 `completed`、conclusion 是终值。这个修法在「API 对在飞 job 根本
  不报」与「报得慢」两种成因下都成立，不必先分清成因（抽样 338 个在飞 job 得 0 命中，
  而那个窗口只有几秒，取不到不等于没有）；在 job 内部轮询等自己 completed 是死锁，
  所以那条路不走。同族先例是 `pr-gate.yml` 的 `ga-verdict-callback`。

  代价：红的那一跑多起一个 job（检出 + 装 Node，整条 import 链只吃 `node:*`，不装依赖）；
  绿跑该 job 直接 `skipped`，一个字节都不付。`环境证据` 仍留在 `daily` 里 —— dmesg / free
  读的是那台机器自己的事实，跨 job 就读不到了。

- **判据同批跟上，且都能被打红**。`tests/no-platform-ci-config.test.ts`：顺序类判据改用
  新的 `gaDailyJobSteps()`（只取 `daily` 那个 job），成员资格类仍用整份文件的
  `gaDailySteps()` —— 两个 job 之后「谁排在谁前面」与「有没有执行者」是两个问题，混用会让
  顺序判据把另一个 job 的 step 也算进来。立案那条判据改钉 job 级限形，并新增**反面锚**：
  `daily` 里不许再出现这一格（挪回去即红）。五条变异（搬回 step / 摘 `needs` /
  `failure()`→`always()` / 摘 `continue-on-error` / 换掉 run 的脚本）实测全部打红。
  `tests/ci-ga-daily-failure-issue.test.ts` 补下游 job 拓扑的两条用例（跨 job 取上游红格、
  端到端真建单）—— 旧夹具只造一个 job，盖不到这一形；把实现变异成「只读最后一个 job」
  时恰好这两条红、原有 20 条全绿。
  `tests/ci-container-plan.test.ts` 的 step 块提取补上 **job 边界**：它原先只认「下一个
  6 空格 step 头」，于是 `daily` 的**最后一步**会把下一个 job 的头整段吞进来，`env:` 的收键层
  一路收到 `  daily-failure-issue:` 那一行上，报出「缩进 2，该在 8」这种指不到真因的红。
  真 YAML 解析复核过：那份 `env` 挂得是对的、也没有键漏到别层 ⇒ 是扫描器的单 job 假设，
  不是配置错。修后提取与真解析逐字对齐（18 step / 18 块、名字一致、零块混进 job 头、
  `env` 在场性零不一致）。