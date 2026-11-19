## Changed

- **B4 子批 1：55 份 / 204 处 `eslint/prefer-named-capture-group` 清零**（判决面删掉这 55 份路径行）。
  处理口径：捕获值**没人消费**的正则改成非捕获组 `(?:...)`（约 89 处）；**被消费**的加命名组并
  同步改消费点（`m[1]` → `m.groups.<name>`、`"$1"` → `"$<name>"`、`?.groups?.<name>`，约 115 处）。
- 其中 `scripts/standalone-private-inputs.mjs` 的 5 条形状正则同步改为 `(?:^|/)`，只为保住
  「两侧逐字同源」判据（与 `check-standalone-contents.cjs` 一致），语义等价。
- 台账：B4 行改「清账中（子批1：55 份 / 204 处已清）」。
- 清账总账：#3181（本批挂 `Refs`）。
