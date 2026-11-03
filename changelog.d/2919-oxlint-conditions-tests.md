## Fixed

- **测试层 `no-unnecessary-condition` 清零（B2：`tests/**` + `e2e/**`，11 处 / 6 文件）**：
  该规则此前不在 41 条零容忍集里，测试面累积了 11 处诊断，全属 `??` 左值恒非空 / 多余
  可选链两类。处置口径与 B1 同形，按来源判：

  1. **左值类型确实不可空**：直接删兜底。`tests/helpers/test-db.ts` 的 `params ?? []`
     收敛为直接展开 `params`（宿主形参声明为 `Array<unknown>`，drizzle 必传）；
     `tests/helpers/theme-tokens.ts` 的 `atrule.name ?? ""` 收敛为 `atrule.name`
     （postcss `AtRule.name` 必填）；`e2e/support/preflight-python.mjs` 的
     `found.args ?? []`（4 处连带 `absolute ?? found.command` 兜底）收敛为直接取值
     —— `PythonResolution.args` 是必填 `Array<string>`、`found.path` 是必填 `string`，
     那个「解析不到绝对路径」的话术分支按类型不可达，随之去掉。
  2. **运行期可能为空的外部形状**：保留守卫并加台账。`tests/helpers/gate-repo.ts` 的
     `res.stdout ?? ""` / `res.stderr ?? ""`（`spawnSync` 起不来时两值为 null，
     且两流合一的原始形状是门禁自测断言的承重面）；`e2e/support/preflight-browser.mjs`
     的 `result.error?.message ?? ""`（`catch` 的 unknown 断言成 `Error`，注入的
     `launch` 可能不回该字段）。两处各加一行
     `// oxlint-disable-next-line no-unnecessary-condition -- <理由>`（共 3 行，覆盖 4 处诊断）。
  3. **类型在说谎的那一格**：`e2e/support/preflight-ports.mjs` 的 `isFakeServerCmdline`
     运行期确实会收到 `null`（`tests/e2e-reclaim-own-fake-port.test.ts` 显式断言该格
     必须判 `false`），于是把 `@param` 从 `{string}` 改成 `{string | null | undefined}`，
     守卫留在原位 —— 不删运行时语义，也不留一条假命中。

  配置层一个字没动（`oxlint.config.ts` / `eslint.config.js` / `.cnb.yml` 均未改），
  也没有新增任何其它规则的禁用。

  验证：`oxlint -c oxlint.config.ts --type-aware tests e2e` 该规则 **11 → 0**，
  改动行零新增诊断（含 `no-unnecessary-type-conversion` 与 `Unused disable`）；
  台账 3 行逐条带理由、只压本规则；全仓 `tsc --noEmit` 0 错；
  6 份改动文件 `eslint --max-warnings 0` 通过；`check:oxlint-zero-rules`
  （41 条 × 2437 份文件）0 命中；`check-infra-file-size` OK；
  相关 `vitest` 15 文件 251 通过 / 15 跳过（`check-branch-guard` 平台条件跳过，既有）。
