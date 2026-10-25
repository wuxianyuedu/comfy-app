## Fixed

- **取证层的形态断言跟上守卫**：`scripts/merged-side-loss-git.mjs` 的 `historyByFile()`
  在 #2272 里给 git 参数加了前缀 `-c core.quotePath=false`（非 ASCII 路径被 git 默认
  转义 ⇒ `set.has(line)` 对不上 ⇒ 判据恒绿），但 `tests/merged-side-loss-git.test.ts`
  第 116 行仍按**旧参数数组**断言 ⇒ 用例恒红，PR 的「受影响用例」那格连带把其后 22 格
  全压成 skipped。

  断言把 `-c core.quotePath=false` 前缀一起钉住，而不是从期望里放宽掉 —— 这个前缀是
  判据正确性的承重部分，摘掉它这一层看不见（回的正是那个恒绿）。现场与因果见 ISSUE #2301。
