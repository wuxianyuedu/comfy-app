## Fixed

- 并入 `master`（`f1ebfc7e`「声明 ⇄ 读者索引」）并解决冲突 —— 冲突形态是**两侧都在同一处
  追加**，加起来的真身是两条都保留：
  - `scripts/affected-tests.mjs`（`FIXED_STRUCTURAL_TESTS` 尾部）：PR 侧新增
    `tests/e2e-run.test.ts`（全量 e2e 新鲜度账的契约测试）、`master` 侧新增
    `tests/declaration-readers-gate.test.ts`（声明索引的契约测试）。两边条目的「为什么
    必须无条件响」各不相同（前者是 import 图追不到的接线文本、后者是「再加一种声明机制」
    时才走得进的路径），取并集。
- **真正需要判断的一处是自动合并漏掉的那一类**：`master` 新增的
  `scripts/.declaration-readers.json` 把「像素基线的档与新鲜度」登记为钩子步骤
  `像素基线每档都有主（新鲜度账）`，而本 PR 把该步标签改成了
  `每档都有主（新鲜度账：像素档 + 全量 e2e）`（这一步现在判两档）—— 索引与钩子各自都
  「合法」，只有 `scripts/check-declaration-readers.cjs` 的双向核对会报「判据在场、
  没人敲它」。故同批把该条目的 `name` / `declaredAt` / `executor.label` 对齐到新口径
  （`declaredAt` 补上 `scripts/.e2e-freshness.json`）。
  这类冲突 git 不会报：两侧改的甚至不是同一个文件，是**同一条口径的两半**。
- 并入 `master`（`91edd3fc`「裸 sleep 收口」ISSUE #1498）：文本层无冲突，但它落在
  `FIXED_STRUCTURAL_TESTS` 与 `.githooks/pre-commit` 这两处本 PR 也动过的地方 ——
  前者的三条条目（裸 sleep / 全量 e2e / 声明索引）已同处一清单、逐条各守一件事；
  后者是**它自己漏记的一笔账**：新增 `scripts/check-test-sleep.cjs` 后钩子 D 组从
  42 步变成 43 步，而注释里的「`D(42 个判据脚本)`」没跟着改
  （该注释自己就写着「新增判据时必须同步这个数字」，核它的是
  `tests/doc-check-hook-wiring.test.ts`）。在 `91edd3fc` 干净基线上复算过 ——
  这条红**不是本 PR 引入的**（§13.6.2 的别线红），判据不放宽，只把数字改对。
