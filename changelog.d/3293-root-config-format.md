## Changed

- 根级 `drizzle.config.ts`、`oxlint.config.ts` 迁到 oxfmt 100 列（只改排版，不改内容）；
  全仓曾命中格式判据的 `*.config.*` 存量清零。
- `*.config.{js,ts,mjs,cjs}` **继续留在** `IGNORE_GLOBS`：全量档只逐 `SCAN_ROOTS` 跑，
  根级文件不在任何扫描根 ⇒ 把这一条移出白名单**不会改变全量档的判决面**（移出是假动作，
  只会把 `isScanned()` 的声明面变宽）。这两份的实际判决面是 `--changed` / `--staged`，
  被碰时才判。口径已写进 `scripts/check-format.cjs` 的 `IGNORE_GLOBS` 注。
- 同批订正 `isChangedFaceFile()` 上方的过期读数：`#3251` 迁完 `scripts`/`tools`/`e2e`
  后，不在全量档面内的只剩 `tests` 368 份 + 根级 7 份（2026-11-07 实测）。
