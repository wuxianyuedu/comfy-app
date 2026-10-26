## Fixed

- **`prettier 格式` 的回写委托撞 403 时不再退 0**（ISSUE #2378，PR #2375 首跑现场）：
  `api_trigger_formatfix` 委托口此前只看 `cnb build start-build` 的退出码，而
  403 / scope 不足那一族平台照旧退 0 ⇒ 这一格念着「委托已发出」退 0，修复留在
  工作区，红移到六格之后的「工作区出处」且原因指向前一格。现在「发出去」的唯一
  证据是回读到 `sn`（`ship-exec.mjs` 新增 `buildSnFromOutput()`，与探针口
  `startProbe` 共用同一份取 sn 实现）；读不到 ⇒ 按「委托没发出去」照旧红，
  平台读数原样带出。
- **自动修登记表的 `outputs` 从 glob 改字面目录前缀**：`AUTOFIX_DUTIES` 的
  prettier 档此前写 `src/**` / `.storybook/**`，而消费方 `underWriter()` 是
  `startsWith` 的字面匹配 ⇒ prettier 档写过的文件（如 `src/components/…`）
  永远进不了「允许写脏」名单。现在写 `src/` / `.storybook/`，与 `docs/generated/`
  档同形；收窄登记表（`INCREMENTAL_GATES`）的 glob 是另一处消费方真懂 glob 的
  名单，不受影响。
