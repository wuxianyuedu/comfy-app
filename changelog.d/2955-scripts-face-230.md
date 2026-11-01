## Fixed

脚本档棘轮台账的 `face` 补到 230（#2955）。

- 现场：`26a3c3ed`（#2948）新增 `scripts/suspended-gate-tests.mjs`，主干上的面从 229 涨到 230，
  账本还在 229 ⇒ 从它分出的每一条分支在「固定结构用例」那一格先撞一次
  「配置展开 230 份，账上写 229」。这是 `face` 手写副本的老形态（上一例 #2947）。
- 修法仍是把账记上：`face` 229 → 230，`total` / `files` 保持空账。
- 读数：`node scripts/check-scripts-typecheck.cjs --no-run` → 「展开 230 份（入库的 230 份）」；
  `git ls-tree -r --name-only HEAD` 的 `.mjs` 数同为 230。

#2955
