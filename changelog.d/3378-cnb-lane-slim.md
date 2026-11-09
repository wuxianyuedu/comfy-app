## Changed

- **CNB 侧退成「站内回读结论 + 平台池镜像出口」，只为过去承重而存在的格子退役（ISSUE #3378 收尾 / #3397）**：业主口径「有些是因为之前 CNB 侧承重才使用的，现在没必要的就去掉，能挪到 GA 侧的就挪过去」。
  - **删**：PR 档 `镜像身份` / `工作区复用读数` / `缓存槽读数` / `环境前提`（自托管节点读数，GA `pr-gate.yml` 承接全部代码判据后无消费者）；PR / 桌包 / push 三处 `endStages` 的 `令牌权限读数`（只剩每日档那一格）；push 主列整条（`合并形态复核` 是形态留痕、真防线是平台分支保护；`安装依赖` 只被文档链吃；`工作区出处` 是自托管专有读数）。
  - **挪 GA**：push 档 `生成态文档与源同步` / `文档引用与权威源一致` 由 `.github/workflows/master-gate.yml` 同款 step 承接（§13.5.34 并行期逐格比对后切换，同款入口、同款旗标）。
  - **保留承重锚**：PR 档 `GA 回调结论回读`（把 GA 结论折成 `pull_request` build 退码，§13.6「PR 跑绿才合并」不换锚）、两档 `失败立案`、两条平台池镜像出口。**没动** `api_trigger_ga_verdict` 回调 build 与保护分支设置。
  - `COMFYAPP_CI_GATES` 缩到 3 格、`COMFYAPP_CI_PUSH_GATES` 键随主列删除；`push 失败立案` 内联进平台池镜像出口的 `endStages`（`--lane push`）。
  - 逐笔对账同批：`GATE_TIER_LEDGER` 的 retired 段逐条写明「现在谁跑」、`AUTOFIX_DUTIES` / `INCREMENTAL_GATES` 的执行面从 `.cnb.yml` 扩到 GA `master-gate.yml`（表内容不空转）、`ci-oneshot-gates.mjs` 的 `source` 摘除、`ci-token-scopes.mjs` 触发口映射收敛到每日档、两份顺序锚契约用例 / `doc-check-hook-wiring.test.ts` 的 `platformExecutor` / §13.5.35 + 生成态镜像 / `master-gate.yml` 头注。**脚本与判据完整留盘**，恢复动作 = 加回 stage + 挪回清单 + 从 retired 摘掉。
  - 边界（没假装已验）：保护分支是否计入 `cnb/api_trigger_ga_verdict/*` 的端到端合并按钮实测仍缺 `repo-manage:r` 令牌没坐实 —— 这正是承重回读格不能删的理由；GA `--autofix` 写的是 GA 自己的工作区，`docs/generated/**` 镜像由本地 D0 同批判据守；`push 失败立案` 内联那一跳没在 push 节点单独实测过，另由每日 `镜像漂移判据` 兜底。
