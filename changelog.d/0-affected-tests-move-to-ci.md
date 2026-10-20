## Changed

- **「受影响用例」这一档的两个本地执行者都撤了，改成平台侧 PR 流水线的 `受影响用例` 一格**
  （业主口径：「pre-push 和 precommit 中这种可能超时的都去掉，挪 CI 执行」）。
- 立案读数：这一档会起 vitest 子进程，而共享机（另一条检出并发推自己的分支 + 多个 dev server
  抢核）上它的失效形态**不是用例红**，是 `Failed to start forks worker /
Timeout waiting for worker to respond` —— 实测 pre-push 的那一档被这种调度超时拦下，而
  隔离复跑 88 个用例文件 / 1116 条**全绿**。也就是说拦与放都和代码无关：本地这一跳在最需要
  给出结论的机器上给的恰是最不可信的读数。（`unitTests` 段 2026-10-19 才从 pre-commit 搬到
  pre-push，活了不到一天。）
- 撤的两个执行者：`.githooks/pre-commit` 的 C 组（`run_group C` 行**逐字留在钩子里当登记**，
  `tests/hook-affected-launch.test.ts` 钉的就是那个入口形状；`COMFY_HEAVY_GATES=1` 也换不回
  来它，钩子收尾会单独念一句「组 C 本地不再执行」），与 `scripts/premerge-check.mjs` 的
  `unitTests` 段（连 `pushBatchFiles` 一并删——唯一消费方就是它）。**撤段而不是留一段恒跳过**：
  恒跳过的段会让 `--json` 的读数里永远有一格「没跑起来」，而那一格不构成证据（§13.6.2）。
- 新执行者：新增 `scripts/ci-affected-tests.mjs`（跑法脚本，只做三件事——按
  `CNB_PULL_REQUEST_TARGET_SHA` 算这个 PR 的改动面（三点 diff；取不到 ⇒ 退 2，空清单同样退 2：
  放行会让启动器把 vitest 跑成全量，而全量绿在 PR 这一跳上是被 §13.5.21 否掉的读数）、按
  `ci-load.mjs` 的现场核数收敛并发（`COMFY_PRECOMMIT_MAX_WORKERS`）、把退出码三态原样转出去），
  `.cnb.yml` 的 `.gates` 加 `受影响用例` 一格（45m 预算，带 `ci-cp936-exit.mjs` 那层）。
  **判决链一字未改**：起的仍是 `run-affected-tests.mjs`，改动面仍经 `COMFY_AFFECTED_CHANGED`
  走同一条链；超时形态的「等待负载回落 → 隔离复跑 → 仍超时则点名未校验」话术仍由启动器自己负责。
- **全量单测仍在每日档**（`每日单元测试`，§13.5.21 的理由没变：并行 PR 下带超时的读数不可信，
  且它跑绿要刷「整档凭证」）。PR 上这一格判的是**增量面**：不刷整档凭证、不判覆盖率门槛。

## Fixed

- 文档与配置里三处随之过期的说法同批订正：AGENTS 硬规则 7（「单测的 PR 侧执行者就是本地这一跳」）、
  §13.5.25 的档位表 C 行、`.cnb.yml` 的 `COMFYAPP_CI_DISABLED_GATES` 与停用的 `单元测试` 两段注释
  （旧结论「增量档安在本地推送那一跳」已不成立）。`docs/guides/TESTING.md` /
  `PRODUCTION-GAPS.md` 的同族说法一并改。
