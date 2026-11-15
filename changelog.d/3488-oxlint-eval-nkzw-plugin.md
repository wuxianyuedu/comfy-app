## Fixed

- **`oxlint.config.ts`（评估尺）单独评估不再因 awesomeness 预设的外部 jsPlugin 缺失而加载失败**（ISSUE #3488，`oxlint.config.ts`）。

  `oxlint-config-awesomeness` 预设会注册若干外部 jsPlugin（如 `@nkzw/eslint-plugin`），但本仓未必将其作为直接依赖安装；单独执行 `node node_modules/oxlint/bin/oxlint --config oxlint.config.ts <file>` 时会在加载配置阶段报插件缺失并 exit 1。

  评估尺现在仅保留预设随包自带的子路径插件，并同步剔除不可独立加载插件承载的规则与覆盖项，使 `--config oxlint.config.ts` 在当前检出可独立加载与评估；判决配置 `oxlint.parity.config.mjs` 不受影响。
