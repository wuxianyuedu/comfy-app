## Changed

- **oxlint 启用 `eslint/max-params`（T2 结构规模类第一批，issue #3179，台账 §五）**：
  阈值拍板 `{ max: 5 }` —— 实测档（全仓探针：6 参 9 处 + 8 参 1 处全部清零；5 参 34 处合规不动，
  后者集中在启动链关键脚本——`spawnDevServer` / `perCommitShape` 一族，签名改造风险大于收益；
  收 `4` 是后续候选批次）。`complexity` / `max-depth` / `max-nested-calls` 三条维持不开
  （阈值待拍，读数见台账 §五）。清零修法全部是「参数收对象」：`spawnDevServer`（含 dev-launcher
  转发壳与 dev-boot 调用点）、`runActions`（递归链 11 个调用点收 `{reading, ledger, log}`）、
  `fetchRangeToFile`（含注入面 JSDoc 与 selfcheck 假件）、`perCommitShape`、`execImages`、
  `computeKahnLayout`、`pageSummary`、`detail()`（attendance 测试夹具）、`bezierMidpoint`
  （两条曲线各收一点对象）。
