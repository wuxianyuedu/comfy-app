## Changed

**`awesomeness/no-novel-comments` 收官包（#2924）**：`.storybook/**`、根配置面、
`src/trpc/**`、`src/config/**`、`src/(根)`、`tools/**` 实测 **214 处 / 30 份 → 0 处**，
全仓该规则随之清零（0 处 / 0 份）。处置为**按文件逐个登记的目录级例外**（30 条 glob）。

- 全仓复扫锁定命中面后按**文件**分层抽 **119 条**逐条判读：复述型 **0 条（0%）**；
  其余是覆盖率门槛的实测推导、配置项「只写一处会静默失效」的因果、Storybook
  注入层「为什么必须真数据」、runtime 边界与模块头。
- `vitest.config.ts` 28/64、`oxlint.config.ts` 7/7（例外说明注释本身即「为什么」，
  登记而非自删）、`eslint.config.js` 6/6、`playwright.config.ts` 5/10、
  `next.config.js` 5/10，其余文件逐条登记。
- 删除 **0 处**；新增文件不自动继承例外 —— 先抽样再登记，复述型 > 0 的文件走「删复述」。
- 未触碰已清零的四个目录（`scripts/**`、`src/lib/**`、`src/components/**`、`src/app/**`、
  `tests/**`、`src/server/**`、`e2e/**`），未新增任何逐行禁用指令。
