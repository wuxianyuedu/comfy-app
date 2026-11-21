## Fixed

- 产品文档的数据库表计数对齐 schema（#4721）：overview §6 与 launch-and-build 排障表的「共 23 张表」改为现场的 30 张（better-auth 4 + 业务 26），overview 的业务表分组补齐缺失的 7 张（`taskLog`、`llmProvider`，新增「系列与剧集族」五张）并由四组改五组。该计数此后由 `pnpm doc:check` 现场核对（`db.tables.count` / `db.tables.business.count` 两个事实，从 `schema*.ts` 数 `sqliteTable(` 定义），表数再漂当场红，不再靠人发现。
