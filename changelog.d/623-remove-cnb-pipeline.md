## Removed

- **删除平台侧流水线配置 `.cnb.yml`：免费额度 160 核时/月用不起**（ISSUE #623）。
  计量口径是「节点规格 × 运行时长」（每 5 分钟冻结一次，冻结量 = 5 min × 节点规格），
  本流水线声明 `cpus: 8`，一次 PR（门禁 + 合并复核）实测量级接近 1 核时 ——
  一个月几十次 PR 就把额度吃光。删前已把能降的都降过（门禁只挂 `pull_request`、
  `test` 与 `test:coverage` 合成一步、声明 pnpm store 与 Playwright 缓存），
  量级是「减半」，而缺口是「一个数量级」，因此只剩「不跑」这一条路。
- **随之删除 `tests/cnb-pipeline-gates.test.ts`**：它锁的是 `.cnb.yml` 的三十步清单与
  两条流水线的形态，配置不存在后它只会恒红。`scripts/doc-facts.cjs` 的
  `path.cnb.ci` 事实同步注销（path 类事实的语义是「文档指向的文件必须存在」，
  登记一个刻意不存在的文件会让 `pnpm doc:check` 恒红）。

## Changed

- **门禁只剩本地一层：`.githooks/pre-commit`（24 步）**。规范 13.5 改为
  「平台侧当前未启用」，并**逐条登记原来只在 CI 上跑、现在没有执行者的判据**
  （全量单测 + 覆盖率门槛、`build` + standalone 产物护栏、E2E、R5 行数棘轮）——
  这是有意留下的欠账，不是遗漏：把三千多个用例塞进每次 commit 会让本地提交慢到
  没人愿意用，而那正是当初把它放去 CI 的原因。要恢复哪一条，先让它耗时可接受，
  再挂回钩子。
- **`scripts/check-branch-guard.cjs` 的服务端形态保留**（`--pr-check` /
  `--merge-commit`）：平台侧调用方没了，但判据本身仍被
  `tests/check-branch-guard.test.ts` 用真仓库跑着三种拓扑，日后重启流水线直接用。
  规范 13.6.1 的分级表相应收敛为「平台分支保护 + 本地钩子」两层，并说明服务端形态
  为何留着。
- 11.7 / 12.8 / 15 附录 / 主规范与 `.githooks/pre-commit`、`vitest.config.ts`、
  `scripts/check-branch-guard.cjs` 里所有指向 `.cnb.yml` 的表述同步改写；
  `vitest.config.ts` 的 `lcov` reporter **保留**并补写它的用途 ——
  删掉会让日后重启上报时重新踩一遍「插件找不到报告文件」那个坑。
- **合并 master 时折入两条同源口径**（来自 #641 / #646，一并留成 `.cnb.yml`
  删除后的记录，日后重启上报时按它们写）：① 覆盖率上报必须是**排在单元测试之后
  的独立 stage** —— 同一个 stage 里的 `script` 与 `type` 是两个**并行任务**，
  插件容器会在 `coverage/` 尚未产出时就找报告，而 `breakIfNoCoverage` 缺省为
  `true`，找不到即退出；② 报告格式（`coverage.reporter` ↔ 插件 `pattern`）两处
  必须对上，只改一侧不会红。规范 11 与这两条口径同步留档。
- **折入 `--merge-commit` 的服务端形态**（来自 #646）：判据改为「合并提交 **或**
  提交信息带 `PR-URL: #NNN`」，单父且无 PR 关联时保守放行 —— 只判「父提交数 > 1」
  会把规范 §13.6 优先的 Squash Merge 每次都判红。`GUARD_VERSION` 随之为 `3`，
  规范 13.5 / 13.6.1 记下这条口径。
