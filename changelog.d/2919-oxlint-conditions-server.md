## Fixed

- **数据层 `no-unnecessary-condition` 收口（批次①：`src/server/**`，62 处 / 25 份 → 0）**：
  取数用单规则临时配置（`--type-aware -c <only this rule>`），不用仓库判决配置 ——
  后者在测试档不启用该规则（同一份 `json-viewer.test.tsx`，仓库配置 0 / 单规则 1），
  会少报。口径按来源分流，不追求「全仓 0 命中」：机械族改代码，恒真/恒假/外部形状
  保留分支并落台账禁用。

  1. **机械族直接改（35 处诊断 / 33 个站点）**：`??` 左值类型恒非空（`draft.meta.*`、
     `row.idea`、`task.progress`、`result.update.sourceMtime` 等）删兜底；
     `rateLimitedProcedure` 的 `ctx.user.id ?? x-forwarded-for ?? "anon"` 收敛为
     `ctx.user.id`（`authedProcedure` 已保证 user 非空，限流键随之只按 userId，
     上方 JSDoc 同步改口径）；`cfg.model?.trim()` 收敛为 `cfg.model.trim()`；
     测试里 `res.user?.id` / `r?.title` / `detail?.images[0]` 等本仓构造值去掉多余 `?.`。
  2. **保留防御并落台账（27 处诊断 / 26 行禁用，逐行带「值来源 + 为什么不可达/为何保留」）**：
     env（`DATABASE_URL ?? DEFAULT`，`SKIP_ENV_VALIDATION` 下可为空）、better-auth
     `getSession` 可返回 null、tRPC 入参与 DB json 列经 `as` 断言后（`posMap`、
     `tags`、`prod.characters`、`comfyui` 输出、`inputSchema`）、`findFirst` 关联行可能
     缺失、libsql `rowsAffected` 缺省、外部 rejection 值（单测 `codeOf` 信封）、
     以及类型上恒真/恒假的判断（`row.temperature != null`、`projectId === undefined`）。

  配置层一个字没动（`oxlint.config.ts` / `eslint.config.js` / CI 判据均未改），
  也没有新增任何其它规则的禁用。

  验证：单规则口径复扫 `src/server` 该规则 **62 → 0**（82 份文件）；
  全仓 `tsc --noEmit` 0 错；`vitest run src/server` 全绿；
  `pnpm check:premerge` 通过。
