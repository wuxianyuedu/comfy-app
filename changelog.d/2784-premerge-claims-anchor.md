## Fixed

- **`tests/premerge-check.test.ts` 的三条用例不再拿字面 `0` 钉「入口跑没跑」**（PR #2784
  的「受影响用例」那一格反复红 3 条，报的是一句 `expected 2 to be +0`）。它们问的是
  「`--only` / `--json` / `--full` 有没有生效」，却在**真检出**上跑入口，于是把一个与
  题面无关的前提一起钉住了：`claims` / `mergeLoss` 的锚点是
  `git merge-base(<要并进去的那条>, HEAD)`，而 **①** 仓库冻结在合并态（`MERGE_HEAD`
  在场、合并未落地）时它退 1、stdout 为空；**②** 要并进去的那条在这个检出里根本不存在
  （平台节点只 fetch 协商后的单 ref）。两种情形下入口都如实记 **2（没跑起来）** ——
  那是正确的读数，错的是断言。
- 改法：`expectAnchorMissRead(code, output)` —— 绿照旧绿；非 0 只放行「2 + 取不到 /
  算不出锚点」这一形，别的 2（参数不认识、段名不存在……）照旧红。「锚点算不出时不许
  折成 0」仍由既有的 `anchorMissed` 那条用例钉着，它不经过入口、不受这一态影响。
- 判据一个字没动：`scripts/premerge-check.mjs` 与 `scripts/check-commit-claims.mjs` 原样保留。
