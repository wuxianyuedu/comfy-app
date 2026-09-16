## Changed

- **CI 从 GitHub Actions 迁到 CNB 流水线（`.cnb.yml`）**：本仓库跑在 CNB 上，平台只读仓库
  根的 `.cnb.yml`，而 `.github/workflows/ci.yml`（27 步门禁）**从未被触发过一次**
  （构建历史里只有 `issue.comment@npc` / `api_trigger`，`push` 与 `pull_request` 均为 0）
  ——门禁等于死代码。现已整体迁到 `.cnb.yml`（单条流水线「质量门禁」，触发 master 的
  `push` / `pull_request`，30 步串行 + 失败时上传 Playwright 报告），原文件删除。
  每一步的迁移理由都写在 `.cnb.yml` 的注释里。
- **新增回归护栏 `tests/cnb-pipeline-gates.test.ts`**：把「迁移前的每一步在流水线里
  都有承载步骤」「每个承载步骤真的调用对应命令」「门禁一律走 pnpm」「
  `SKIP_ENV_VALIDATION` 必须与 `BETTER_AUTH_SECRET` 成对」「原 workflow 不许回潮」
  锁成可失败断言——`.cnb.yml` 是一条三十步清单，删掉一行不会让构建变红，只会永久
  少一类回归信号。
- **分支守卫的判据自持**：`pull_request` 属 CNB 的「不可信事件」，流水线配置取自源分支
  （触发者能删掉那行调用）。`scripts/check-branch-guard.cjs` 因此自己独立判定源分支
  （不读 `CNB_PULL_REQUEST`），并新增 `--pr-check` 调用形态与判据版本号；`.cnb.yml`
  把它排在**第 1 条**，删掉即失败。
- **文档同步**：`docs/standards/11` §11.7、`13` §13.5/§13.6.1、`12` §12.8、`15` §15.6、
  主规范 §11.2 与 `.githooks/pre-commit` 里所有「CI 唯一事实来源 = `.github/workflows/ci.yml`」
  的口径改为 `.cnb.yml`；新增事实 `path.cnb.ci`（`docs/reference-facts.md` +
  `scripts/doc-facts.cjs`），文件被改名/删掉时 `pnpm doc:check` 当场失败。

## Fixed

- 修正「CI 门禁是唯一事实来源」长期指向一个不生效文件的误导：此前照文档去改
  `.github/workflows/ci.yml` 不会触发任何构建，而规范声称「CI 失败阻断合并」。
