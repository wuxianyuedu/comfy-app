## Fixed

- 退役性能排查台账 `docs/audits/2026-09-26-performance-audit.md`（#3773）：其 §C 七条
  早已全部转 Issue 跟踪并闭环（最后两条 #2191/#2194 已于 10 月下旬修复合并），按
  `docs/README.md` §7.3「全部闭环 → 删除」执行。三处仍指着它的引用同步改写：
  `docs/standards/02-性能规范.md`（改引 PR 号 #970/#971/#973/#980）、
  `docs/audits/2026-10-12-architecture-risk-review.md`（范围声明改述）、
  `tests/log-routes-no-sync-fs.test.ts`（M12 出处注释改述）。修复与决策历史在 git
  与对应 Issue/PR 里，过程文档不再长期保留。
