## Fixed

- `docs/standards/13-提交与-code-review.md` §13.10.16 还停留在 ISSUE #2551 落地时的实现快照，三处**当前态陈述**已与仓库事实脱钩：`grep -n "ci-token-scopes.mjs" .cnb.yml` 现役是四条 `script:` 入口（`.daily-gates` 一条 4 空格、PR / 桌包 / push 的 `endStages` 三条 6 空格），而文档写「三个入口（PR / 每日 / 桌包）都挂在 `endStages` 里」；`tests/ci-token-scopes.test.ts` 现役 26 条用例（#3306 补完入口计数面后），文档写「16 条，全部注入 `run`」；「2026-10-29 追加」段写「这一格挂在三处，三处的路径完全不同」（ISSUE #3310）。
- 三处都已订正，并按 AGENTS 硬规则「别在文档里写死会随源码变动的数字」改成**枚举 + 指向可复核出处**：落成段点名 PR / 每日 / 桌包 / push 四条流水线、说明每日档在 `.daily-gates` 第二格而其余在 `endStages`、点名 push 那一处来自 ISSUE #2842 的 `*push_fail_stage`，并写明「入口数不在这节写死，以 `.cnb.yml` 现役 `script:` 行为准，由 `tests/ci-token-scopes.test.ts` 的入口计数用例守着」；回归段去掉「16 条」，把覆盖面从「判三件事」补成「判下面几件事」并把 #3306 新增的入口计数面列为第 ④ 项，同时订正「全部注入 `run`」为「探针类注入 `run`、接线类只读 `.cnb.yml` 与合成配置」。
- 「三处的路径完全不同」这句本身不准确：PR / 桌包 / push 三档在 `endStages` 里同构，差别只在是哪一条流水线；`whereItLives()` 的 `lanes` 里 push 没有专属分支，落进「按事件名指路」的兜底出口。文档改成「同构 + 兜底不指错格名」，与代码实际行为一致。

## Changed

- `scripts/ci-token-scopes.mjs` 的 `whereItLives()` 文件头是同一事实的第三份副本，原写「挂在三处，三处的路径完全不同」；同步改成枚举四条流水线 + 「入口数不在这里写死，以 `.cnb.yml` 现役 `script:` 行为准」。纯注释，行为、探针表、退码、`formatReadout()` 一律不动。
- `docs/generated/13-提交与-code-review.md` 由 `pnpm doc:gen`（先 `doc:check` 再 `doc:render`）重渲染，同批带上，不手改生成物。渲染器写了 39 份但只有 13 章这一份内容有变化；§13.10.16 段落与源逐字比对 2849 字符全等。
- `PROBES` 实测仍是 14 条，§13.10 另一处「14 条探针」经 #2878 当场核对为正确，不在本次改动面；`.cnb.yml`、四处入口命令、判据逻辑、`--strict` 边界都不在改动面。

## 验证

- `pnpm doc:gen` `exit 0`（内部 `doc:check` 通过）、`pnpm doc:check` 复判绿；源 ⇄ 生成态 §13.10.16 段落逐字相同；旧裸值「三个入口 / 挂在三处 / 路径完全不同 / 16 条」在该章节内清零。
- 定向相邻 6 份用例 310 passed（含 `ci-token-scopes` / `doc-toc` / `check-doc-references` / `ci-incremental-gates` / `doc-check-hook-wiring` / `strip-comments-single-source`）；全库 `pnpm run lint` 384 条规则 `0 warnings 0 errors`；`tsc --noEmit` 0；改动面 `oxfmt --check` 通过。
- `pnpm run check:premerge` 43 条判据红 0 / `current-green`（含「文档源 ⇄ 生成态镜像同批」、CP936 字形登记、注释语言硬闸）。
