## Changed

- oxlint `unicorn/prefer-node-protocol` 全仓清零（#2775）：`scripts/heal-db.cjs` 2 处
  `require("fs")` / `require("path")` → `require("node:fs")` / `require("node:path")`。
  只改模块说明符，Node 解析到的仍是内置模块，运行期形态不变。
