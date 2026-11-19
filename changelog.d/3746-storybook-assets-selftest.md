## Fixed

- **Storybook 资产判据自足**（ISSUE #3746）：`tests/storybook-data-sources.test.ts`
  的「media 清单 ⇄ 磁盘真文件」判据在干净检出的 CI runner 上恒红——资产是
  gitignored 的现生成件（`/.storybook/assets/` 不入库），而 GA 工作流里没有生成步骤。
  现在真名文件缺失时就地调**生成脚本本体**（`ensureStorybookAssets`，幂等、只写该
  gitignore 目录）补齐再判一致性；判据不再依赖「这台机器碰巧跑过 storybook」。
  `missing.png` 仍必须真的不在（失败兜底分支的现场）。

  Refs #3746
