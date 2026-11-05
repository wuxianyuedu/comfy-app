## Fixed

`API 文档生成与自检` 的触发面改从 typedoc 的**真实解析面**派生（ISSUE #2537，事故 #2528）：旧面按 `typedoc.json` 的 `entryPoints` 算，而 typedoc 实际拿 `tsconfig.json` 展开的根建 TS 程序 —— `scripts/publish-desktop-bundle.mjs` 这类被 `tests/**` import 进程序的文件漏在面外，改动它们时那一格静默跳格。

- 触发面不再手抄：`scripts/docs-api-input-closure.mjs` 的 `docsApiTriggerGlobs()` 从 `tsconfig.json` 展开 ∩ git 跟踪文件派生 `dir/**` + 根级 `*.<ext>`，`.cnb.yml` 的 `ifModify` 与 `check-docs-api.cjs` 的 `INPUT_RES` 都取它。
- 新增元测试（`tests/docs-api-input-closure.test.ts`）：typedoc 程序里的每个仓库文件都必须被面罩住（正向）；把面手工改窄 ⇒ 有文件罩不住 ⇒ 红（反向）；只改 `docs/**` 仍不触发。
