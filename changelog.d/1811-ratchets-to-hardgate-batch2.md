## Changed

- **又三条存量已清零的棘轮翻成硬闸（ISSUE #1811，接着 #1815 往下推）**：
  `check-click-keyboard.cjs`（非原生元素上的鼠标专属点击，§6.11）、
  `check-theme-colors.cjs`（未豁免的写死色值，§3.6.1）、
  `check-test-it-each.cjs`（参数化用例 `it.each`，§11.15）—— 各自删掉基线文件与
  `--update` / `--strict` 两支，命中即退 1。

  **为什么是这三条、而不是「所有 0 基线棘轮」**：棘轮是「有存量、逐批治理」的形态，
  但**不是每个 0 基线都该翻**。判据是「它的存量里有没有**合法形态**、以及有没有
  一条给**新判据起步**用的车道」：

  - 这三条的靶子（鼠标专属点击 / 未豁免的写死色值 / `it.each`）**没有合法存量**，
    合法的例外各走**另一条已经存在的车道**（`EXEMPT_SITES` / `EXEMPT_TABLES` 与
    `EXEMPT_FIXED_DARK` / `FIXTURE_SKIP` 与 import 事实判定）—— 棘轮那条路留着，
    只剩「手改 JSON 就能把新违规登记成已知存量」这一个作用；
  - **故意不翻**的那批各有理由：`check-ui-primitives.cjs` 的棘轮车道是**给新 P 规则
    起步**的（脚本文件头明写）；`check-non-null-assertions.cjs` / `check-void-floats.cjs`
    / `check-test-sleep.cjs` / `check-form-field-wiring.cjs` 的存量里**有已登记、逐条
    写明理由的合法形态**（`arr[i]!`、被调方内部已 catch、逐站点 `sleep-ok` 声明、
    「标签行只作小标题」的只读展示行）；`check-overlay-z.cjs` 仍带一条 Z 系列棘轮、
    与 `check-ui-primitives.cjs` 同属「混合」形态。

  **同批登记面**：pre-commit 的 D 组标签与注释改成硬闸口径、`scripts/.a11y-rule-ledger.json`
  的 keeper 说明同步、三份门禁自测改成硬闸语义（含「`--update` 不落盘任何 JSON」这条
  退出通道断头用例）、`tests/ratchet-update-guards.test.ts` 的 `RATCHETS` / `COVERED_LOCALLY`
  摘掉这三条、规范 §3.6.1 / §6.11 / §11.15.1 与 §13 清单同步。

  **顺带修一处陈旧探针**：`tests/check-doc-references.test.ts` 有一条变异用例拿
  `✅ node scripts/check-void-floats.cjs` 当锚点，而 `7bf3e79d` 把这 6 条 AST 判据并进
  聚合档后，规范清单里那一行已经不存在了 —— 锚点命中 0 次，这条用例**在任何检出上都红**
  （不是本次改动引入的，属 §13.6.2 的 `baseline-red`）。就地改成清单里仍存在的行。
