## Changed

- **B4 子批 2：55 份 / 169 处 `eslint/prefer-named-capture-group` 清零**（判决面删掉这 55 份路径行）。
  命名组 131 处（含消费点同步：`m[1]` → `m.groups.<name>`、`"$1"` → `"$<name>"`），
  非捕获组 38 处（组值本就没人读，改 `(?:...)` 即可）。
- 改动集中在 `scripts/ci-*.mjs`、`scripts/launcher-core/*.mjs` 与根目录门禁脚本；
  正则匹配语义未变，只把「按下标取值」换成「按名取值」。
- 台账：B4 行改「清账中（子批1–2：110 份 / 373 处已清）」。
- `scripts/freshness-ledger.mjs` 在本次格式化后越过 900 行硬闸：删掉 3 条**已失效**的
  `oxlint-disable-next-line typescript/no-unnecessary-condition`（该规则不在判决面 384 条里，
  注释早已不起作用；摘除后判决面仍 0 命中），文件回到 899 行。
- 清账总账：#3181（本批挂 `Refs`）。
