## Changed

- `--fetch-issue` 的落点从 `.workbuddy/issues/<号>/` 改为 `.tmp/issues/<号>/`（#3965 业主反馈：抓取材料别放 `.workbuddy/`）；`.tmp/` 已登记进 `.gitignore`，旧行为（整份重写、图片覆盖、按号分目录）不变，已抓取的旧材料随目录一并迁移。
