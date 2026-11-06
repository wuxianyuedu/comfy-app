## Changed

- `eslint/prefer-named-capture-group` 存量再清 20 份 / 66 处：39 处改为命名组并把消费点同步为
  `groups?.<name>`，27 处改为非捕获组（组值无人读）。
- 判决面 `oxlint.parity.config.mjs` 删掉这 20 份路径行；台账 B4 行更新为
  「子批1–8：265 份 / 835 处已清」。
- 去掉测试辅助函数里的 `m[1]!` 收窄，统一改 `?? ""` / `?? 0` 回退；正则语义与断言口径不变。

Refs #3181
