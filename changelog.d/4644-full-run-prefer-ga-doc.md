## Changed

**「要跑一次全量测试，优先派 GA」补成明文**（ISSUE #4644）。此前这个口径只散落在
#4613 的评论与执行者表里，TESTING.md / README 的字面仍指向本地全量。

- `docs/standards/13-提交与-code-review.md` §13.5.23 新增操作口径小节：优先
  `node scripts/ci/ci-ga-dispatch.mjs --preset unit [--sha <sha>]`（→ `oneshot-unit.yml`）
  或等定时的 `每日单元测试`；本地 `pnpm test` / `pnpm run test:coverage` 仍是合法入口
  （跑绿照记新鲜度账），常规用途收窄为快速自检与红的隔离复跑定性。
- `docs/guides/TESTING.md` 同步补同一条，并把「8 worker」旧注改为
  「并发由 `scripts/ci/ci-load.mjs` 按平台档推导」（#4613 起本地默认 cores/2，16 核 ⇒ 8）。
- 纯文档改动：判据、命令、阈值一个字未动。
