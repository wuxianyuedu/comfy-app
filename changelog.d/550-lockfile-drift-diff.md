## Fixed

- **run-local.ps1 / 质量门禁只报「依赖与 lockfile 不一致」，看不出哪里不一致**：两处都只比对两份 lockfile 的哈希，答案只有布尔值 —— 用户既不知道是新增依赖、版本变更还是配置项变动，也不知道该不该删 `node_modules` 重来。现在统一由 `scripts/lockfile/lock-diff.mjs` 分段比对后**逐项打印**：顶层配置（`settings` / `overrides`）、各 importer 的直接依赖（新增 / 删除 / specifier 或解析版本变更）、以及 `packages` / `snapshots` 的条目增删，条目过多时折叠。解析只依赖 Node 内置能力（不引第三方 YAML 解析器，standalone 产物里也不带）；两份 lockfile 的正文段统一按 `---` 分隔取，避免仓库 lockfile 头部的 pnpm 自举段被误判成「重复段落」。只想看差异时可直接跑 `node scripts/lockfile/diff-cli.mjs --installed node_modules\.pnpm\lock.yaml --root .`。
