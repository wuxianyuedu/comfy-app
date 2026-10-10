## Fixed

- `drizzle.config.ts` 不再把 `file:` 前缀剥掉：drizzle-kit 这一路的 sqlite 驱动就是
  `@libsql/client`（实测 drizzle-kit@0.31.11），而 libsql 把裸字符串按 URL 解析 ——
  绝对 Windows 地址 `C:\…\db.sqlite` 被读成 scheme 等于 "C:" 并抛
  `URL_SCHEME_NOT_SUPPORTED`，**且报错后仍然 exit 0**。日常 `.env` 的
  `file:./db.sqlite` 剥完没有冒号，所以这一档只在**绝对路径**上暴露，而运行期装配的
  `DATABASE_URL`（`scripts/launcher-core/standalone-runtime-env.mjs`）正是绝对形式。
  现在改成「没有 scheme 才补 `file:`」，scheme 判定要求至少两个字符（单字母盘符不算），
  空串兜底与 `src/server/db.ts::resolveDbPath` 逐字同形；`resolveSqlitePath` 一并跟上。
- `scripts/db-migrate.mjs` / `scripts/db-push.mjs` 的失败话术把 drizzle 自己的
  stdout 与 stderr 一起打出来：原先只转发 stdout，那句「输出见上」指的是上面**没有**
  的另一半（硬规则 4「失败路径必须给出原因」的又一形态）。

## Added

- `tests/db-migrate-noninteractive.test.ts` 的「库地址形态」一组三条：五种
  `DATABASE_URL` 形态都不许退化成裸盘符且与 `resolveSqlitePath` 同一锚点（与机器无关）、
  绝对临时库 + 真 `drizzle/` 必须真的落表、失败话术里必须带真输出。
  反向验证过：退回旧 config 时前两条红、把话术改回「输出见上」时第三条红。
  `tests/db-migrate-equivalence.test.ts`（版本化迁移 ⇄ `db:push` 的 schema 等价）
  在 Windows 上此前恒红，就是这个地址被剥坏 —— 现在 5/5 绿。
