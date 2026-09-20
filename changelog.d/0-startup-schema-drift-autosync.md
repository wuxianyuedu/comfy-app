## Added

- **启动链路自己发现 schema 漂移并按需同步，不再需要「记得跑 `pnpm db:push`」**：三个启动入口（`pnpm dev` / `pnpm start` / 桌面启动器）都改走 `scripts/db-schema-state.mjs::ensureSchemaCurrent`，判据是 **schema 指纹**（`src/server/db/*.ts` 的内容哈希，`db:push` 成功后写进库的 `PRAGMA user_version`）：
  - 指纹一致 → 毫秒级通过，**不起 drizzle**；
  - 指纹不一致 + 待执行语句只有「建表 / 建索引 / 加列」→ **自动应用**并登记指纹；
  - 指纹不一致 + 含「删列 / 重建表」→ **不自动执行**：把语句列出来，提示跑 `pnpm db:push`（带 `--force`，由人确认丢数据）。

  判据建在 `drizzle-kit push` 被 TTY 挡下时的那一次输出上（`strict: true` 让它先列出语句再要求确认，无 TTY 于是原地退出且库不动 —— 那一次恰好是一份免费的 dry-run）。白名单是**白名单**而非黑名单：漏认的代价落在「交人工」一侧。

## Changed

- `scripts/db-push.mjs` 的「复核结构」与「跑一次 push 并复核真的落地」抽成 `scripts/db-push-core.mjs`，`pnpm db:push` 与启动链路共用一份判据（不再各写一遍）；成功后登记 schema 指纹。
- `scripts/db-push.mjs` 的输出改为先捕获再转发（`pipe` + forward），否则判据拿不到文本、会静默失效。

## Fixed

- `docs/standards/launch-and-build.md` §2 第 8 条此前写「依赖预检后执行 `pnpm exec drizzle-kit push` … 失败仅 WARN，日志 `log/launcher/drizzle-push-stdout/stderr.log`」——那是 `.ps1` 启动链的行为，`dev-launcher.mjs` 从未实现过（它只探哨兵表 `task`），已按实际改口径。
