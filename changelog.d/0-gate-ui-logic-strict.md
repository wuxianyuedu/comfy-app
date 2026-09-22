## Changed

- **`check-ui-logic-separation.cjs` 在 pre-commit 里升到 `--strict`**：
  AGENTS.md 硬规则 10 早就明写「治理后必须 `node scripts/check-ui-logic-separation.cjs
  --update` 收紧基线」，但脚本此前只**提示**不**阻断**——效果就是"基线虚高、
  下一个改动借余量偷偷新增一处违规也过门"。加上 `--strict` 之后，同一次提交
  里若视图层违规数下降了、却没同步跑 `--update` 收紧基线，pre-commit 会阻断并
  给出修法。把「纪律」变成「机器判据」，与 `check-function-length` /
  `check-code-duplication` / `check-non-null-assertions` 三个基线棘轮同一档。
  当前基线为 `total: 0`（`scripts/.ui-logic-baseline.json`），`--strict` 立即
  生效也不会挡下任何存量提交——它管的是**未来**「降了没收紧」这一族。
