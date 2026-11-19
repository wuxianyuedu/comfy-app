## Changed

- **GA 两条 schedule 挪出整点，名义时刻北京 01:00 → 01:37、03:00 → 03:37（ISSUE #3485）**：GitHub 官方明示 schedule 在高负载（含每小时开头）下会延迟、负载够高时排队任务可能被整条丢弃 —— 2026-11-09 的 `Daily (mirror)` 缺席（API 里该仓 `schedule` 事件计数为 0，无 run、无 cancelled）即此形态；历史读数也印证整点从来没准点过（Daily 名义 17:00 UTC 实际落在 20:35–22:27Z，桌包 19:00 落在 22:31–23:55Z）。
  - `daily.yml` `0 17 * * *` → `37 17 * * *`，`package-desktop.yml` `0 19 * * *` → `37 19 * * *`；理由与 UTC 对位写进两份文件头注释。
  - 同批对齐口径面：`tests/no-platform-ci-config.test.ts` 两条 cron 钉死断言与注释、`.cnb.yml` 16 处现行口径注释（4 处退役 crontab 时代的历史沿革保留原文）、规范 11/13 章与 `docs/README.md` 的「每天 01:00 那一跑」表述（§13.5.23 的 ⚠️ 段补 #3485 依据）、`scripts/check-docs-api.cjs` 与两份测试注释。
  - **不动**：`code-scanning-triage.yml` 的 `0 18`（不在本单范围，需要时另案）；测试夹具时间戳；`check-daily-attendance.mjs`（按事件名前缀认档、不认钟点，天然免疫）；CNB `crontab` 换点史记载。
