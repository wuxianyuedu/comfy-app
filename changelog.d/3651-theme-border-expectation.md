## Fixed

- **主题别名 token 用例的浅色 `--border` 期望值对齐现值 `#e2e4ec`（#3651）**：
  `tests/theme-dark-token-cascade.test.ts` 的「浅色下仍取浅色值」一条自
  #3540（浅色描边有意加深）合入起就在 `master` 基线上红（期望 `#ececf1`、
  现值 `#e2e4ec`），每日全量单测因此带红。改的是**期望值**、不是判据，
  也不登记 `KNOWN_FAILED_FILES`；同用例其余 5 处写死色值逐一对照
  `src/app/globals.css` 现值核过，无第二处陈旧。
