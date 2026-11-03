## Fixed

**本地与平台的 oxfmt 判面指向同一事实源，全量欠账改为显式盘点**（ISSUE #3011）：

- `package.json` 的 `oxfmt` 从 `^0.75.0` 改为精确 `0.75.0`，锁文件 specifier 同步 ——
  本地与平台（`pnpm install --frozen-lockfile`）不再存在「范围写法各装一份」的漂移面。
- `format:check` 改为 `node scripts/check-format.cjs --changed`，与 `.cnb.yml` 的
  「oxfmt 格式」、`pnpm check:all` 同一条命令；新增 `format:report`（`--report`）
  只列全量欠账清单、退 0。`format:ratchet` 保持不带旗标的全量硬闸（迁移完成才绿），
  日常判定不再用它。
- `tests/doc-check-hook-wiring.test.ts` 补三条契约：平台那格的 `script:` 必须含
  `--changed`、本地 `format:check` 必须是同一条命令、`format:report` 必须走 `--report`、
  `oxfmt` 声明必须是精确版本 —— 任一处改判面即红。
- 文档同步（13 §13.5.1.1 / 11 规则清单 / 15 附录 / 开发规范速查表）：平台是
  `--changed`（改动面 ∩ 扫描面），本地日常用 `format:check`，存量盘点用 `format:report`。
- **117 份存量一份都没动**：那是 `printWidth` 80→100 增量迁移的欠账（立案时 146 份），
  一次性全量重排会触发 `check-merged-side-loss`（#1617）并破坏 blame。
