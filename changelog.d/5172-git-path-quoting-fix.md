## Fixed
- 新落地的 `pnpm status:checkout` 与 `pnpm test:affected` 读 git 路径时未带 `-c core.quotePath=false`，非 ASCII 路径会被转义加引号；`git-path-quoting` 硬闸在合并态把它抓住。现在两处都按唯一口径带该旗标，本地 5 条相关用例全绿。
