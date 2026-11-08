## Fixed

- **复合档 `重档静态判据` 的「依赖新鲜度」在 GA 合成 merge 预览态不再误报（#3415，PR #3366 现场）**：
  `scripts/ci-heavy-gates.mjs` 的 `heavyGateArgv()` 此前把钩子里
  `check-deps-freshness.mjs --staged` 按默认口径剥成全量判，于是判据 ②（基线依赖 ⇄ 远端）
  在每次 CI 都跑。平台构造的合成 merge 提交第一父是派发那刻的 master 快照，而 master 在
  PR 存活期间继续前进（本例 `299c9876a` 给 `package.json` 加了一行 script）⇒ ② 拿
  「分叉点 vs 领先后的 `origin/master`」比对，报「你的基线旧了」，出口却是 `git pull`
  —— 开发者无从 pull 一个平台造出来的落后 base。§13.5.13 逐字写过「每次提交都拿它拦人 =
  一条天天红的闸」，剥旗标把这条防线拆了。现在这一步换发 `--offline`：复合档只判 ③
  （本地安装 ⇄ 本检出声明），② 仍由 `pnpm check:deps-freshness` 与钩子 `--staged` 那一档把守，
  判据脚本一字不改。
- 同步面：规范 §13.5.13 补「复合档为什么只判 ③」，`tests/ci-heavy-gates.test.ts` 补一条
  换发契约用例（含「不带 `--staged` / 别的 `--staged` 步骤」两条反向对照）。
- 验证：合成态本地复跑 `ci-heavy-gates.mjs --no-narrow` 由「红 1、判过 60」转
  「红 0、判过 61」；`tests/ci-heavy-gates.test.ts` 全绿。
