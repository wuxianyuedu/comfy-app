## Changed

- **CI（GA 每日镜像档补上「失败立案」执行者）**：`.github/workflows/daily.yml` 末尾新增一格
  `失败立案`（`if: failure()` + `continue-on-error: true`），跑
  `node scripts/ci-ga-daily-failure-issue.mjs --no-block`：用内置 `GITHUB_TOKEN` 读**这一跑自己**
  的 jobs、按 `conclusion=failure` 认出红在哪些格，再用 `CNB_ISSUE_TOKEN` 在 CNB 建单
  （标题键 `红在「<格名>」`，同一格再红只追加读数不新建；写后独立回读）。此前这一格只在 CNB 侧有
  （判的是 CNB 自己的上一跑），GA 这一跑红了等于那天主干没有行为面读数（缺口现场 #3368 / #3435）。
  三态退码 `0/1/2` + `--dry-run`；拿不到读数一律零写入。`permissions` 补 `actions: read`，
  `daily.yml` 文件头那条「刻意不承接：每日失败立案」随之更正为「曾经不承接、理由已不成立」。
  契约用例 `tests/ci-ga-daily-failure-issue.test.ts`（20 条：认红格 / 去重两向 / 四种零写入 /
  建单回读 / 追加不新建 / `--dry-run` / `--no-block` 只改退码不改话术）。

## Fixed

- **E2E：`e2e/model-library.spec.ts` 跟上 #3368 的模型库改版**：用例还在锚「模型目录配置」按钮、
  「按类型筛选模型」radiogroup 与旧空态文案 `模型库还没有内容`，三者在 #3368（模型库改为左侧目录 +
  右侧列表、目录全部默认启用）里都已整段退役，于是 2026-11-08 的每日档红在全量E2E（`gh run
  --log-failed` 读到的是这三条 `toBeVisible` 超时，不是产品缺陷）。改为锚仍成立的形状：页头、
  搜索框、空态按真实原因分档的两句标题，或有数据时的模型文件列表（`role="list"`）——
  `or()` 让两支都写进断言，不写 `if`；死链断言原样保留。
