## Added

- **主题色扫描器把「类型色例外」做成机器可读的显式豁免**：新增 `scripts/check-theme-colors.cjs`（`pnpm theme:scan` 出清单 / `pnpm theme:check` 棘轮检查），按规范 03 §3.6.1 逐条列出被豁免的文件 + 顶层标识符 + 理由（`EXEMPT_TABLES` 类型色例外、`EXEMPT_FIXED_DARK` 固定暗色清单），扫描时据此把两类例外剔出报告。此前豁免只写在规范与 `globals.css` 注释里，是人读的口径，扫描器没有机器可读的清单，导致同一批类型色（端口类型色 / 节点类别色 / 参数分组色）每轮都被当漏网再报一遍。豁免之外的存量写死色值按「文件 → 处数」记账（`scripts/.theme-color-baseline.json`），只许降不许升，已接入 pre-commit 与 CI。

## Changed

- 规范 03 §3.6.1 与 `globals.css` 的「固定暗色清单」补「机器化」一节：增删条目时注释块、规范与扫描脚本豁免清单**三处同步改**，并写明「豁免必须显式、不做模糊放行」的口径。
