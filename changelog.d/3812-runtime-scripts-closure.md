## Fixed

- **产物清单漏登记的判据面补上了**（ISSUE #3812）：`tests/dist-artifact-hygiene.test.ts`
  对编排器闭包成员（`db-backup-core.mjs` / `launcher-core/*` …）的消费是**运行时读文本
  解析**，「受影响用例」的静态 import 图追不到 —— #3732 那批漏登记 `app-data-backup.mjs`、
  主干上 `dist-artifact-hygiene` 长期红，就是从这一格漏的（判据在场，但那一跳没人被拦）。
  现在改动命中编排器闭包成员、或判据直接读文本的 `check-standalone-contents.cjs` /
  `build-desktop.mjs` 时，这份判据会被带进增量面（`scripts/affected-tests.mjs` 判据 ⑤）。
- 闭包算法收成唯一实现 `scripts/launcher-closure.mjs`：`tests/dist-artifact-hygiene.test.ts`
  与 `scripts/affected-tests.mjs` 共用同一份（各抄一份就会漂，漂的形态恰是「闭包算少了 ⇒
  静默漏判」）；判据 ⑤ 的成员判定与按需计算收在 `scripts/affected-launcher-hygiene.mjs`
  （affected-tests.mjs 因此拆出，回到基础设施层 900 行硬闸内）。
- 清单本身（两份 `RUNTIME_SCRIPTS` 补登记 `app-data-backup.mjs`）已由 #3780 那次 PR 落地，
  本笔只补判据面。
