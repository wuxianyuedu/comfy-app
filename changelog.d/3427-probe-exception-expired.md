## Fixed

- **锁编排探针（ISSUE #2363）的有期限例外到期退役（#3427）**：`PROBE_BY =
  2026-11-09T00:00:00Z` 一过，`tests/no-platform-ci-config.test.ts` 的「探针例外有期限」
  用例按设计转红，而它是固定结构清单里的一条（GA `pr-gate.yml` 的
  `fixed-structural-tests` 每 PR 都跑）⇒ 从那一刻起每个 PR 都会红在这一格，与改动无关。
  干净基线（`origin/master` @ `6516315ca` 的 worktree）复跑同样恒红 ⇒ `baseline-red`。
  按用例原话与 §13.6.2「挡路的就地修掉」执行那次删除：`.cnb.yml` 去掉三条
  `api_trigger_probe_*` 流水线与 `.lock-probe-a` 锚点；用例侧去掉
  `PROBE_PIPELINES` / `PROBE_BY` / `PROBE_LOCK_EXEMPT`、到期用例、`lockClassViolations`
  里的两处豁免、锚点计数里的 `probing` 例外、反向自检的 `probeFixture` 一族。
  探针读数入口 `scripts/ci-probe-lock-readout.mjs` 完整留盘（它不依赖那三条在册事件
  才能作为只读工具用），历史读数留在 git log / ISSUE #2363。
  这是**独立的治理动作**：与本批镜像出口换机器（#3426）不是同一诉求，故单独一单、
  单独一笔提交，不混进那张 PR 的改动叙述里；但它必须同批落地，否则那张 PR 的平台 CI
  会被这条与内容无关的基线红拦住。
