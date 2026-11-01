## Fixed

- 脚本档类型检查棘轮的台账（`scripts/.scripts-typecheck-baseline.json`）漏记 #2931 新增的
  `scripts/premerge-timing.mjs`：`face` 停在 228，而 `tsconfig.scripts.json` 已展开 229 份，
  `tests/scripts-typecheck-ratchet.test.ts` 的「真仓的账本 ⇄ 真仓的面」那一格在主干上常红
  （任何 PR 的受影响用例跑到它就红）。
- 修法走判据自己的写入面：`node scripts/check-scripts-typecheck.cjs --update` 现算后重写
  （面 229 份 / 存量 0 处 / 0 份文件），不手改数字。台账之外一个字段都没动。
