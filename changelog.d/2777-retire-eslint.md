## Changed

#2777 / #3157：**eslint 退役**，lint 收成 oxlint 单档（`pnpm run lint` = `lint:oxlint`）。

- 删 `eslint.config.js`、`lint:policy` 脚本与 `@typescript-eslint/parser` /
  `eslint-plugin-react-hooks` 两个 devDependency；插件包留着是给 oxlint 的 `jsPlugins` /
  `settings` 复用（最小集见 AGENTS.md「lint 判据」那节）。`eslint` 包**保留**：它只作
  `eslint-plugin-react`（`require("eslint/package.json")`）与 `eslint-plugin-unused-imports`
  （`eslint/use-at-your-own-risk`）的运行时宿主，不再是 lint 执行器 —— 实测删包会让判决
  配置直接加载失败，且 oxlint 原生没有 `react/no-deprecated` 等价规则。
- 随 eslint 一并删掉 `scripts/eslint-cache-fingerprint.mjs` 与
  `tests/eslint-cache-fingerprint.test.ts`：`--cache` 不再存在，依赖指纹那一步没有对象。
- 原本住 eslint 侧的 `react-hooks/*` 12 条随退役删除。其中 `config` / `gating` 已证两引擎
  无 options 均 0 诊断，启用只让全仓 lint 34s→64s（+80%）零收益；其余 10 条退役前全仓
  0 诊断，且 oxlint 无等价实现。
- 判据面改到 oxlint 配置：`check-a11y-rules.cjs` 去掉 `loadEslintConfig`，a11y 自测改读
  `loadOxlintConfig`；`router-error-envelope` / `store-selector-shape` 的行为验真从 eslint
  `Linter` 换成真 oxlint CLI 探针（新增 `tests/helpers/oxlint-probe.ts`）；storybook /
  `fixed-gate-input-faces` / `ps1-consistency` 的引用面同步。
- 零警告语义不变：`lint:oxlint` 的 `--deny-warnings`；`check:premerge` 继承 `lint`，
  pre-push 与平台那一格跟着走（平台格子名「ESLint 零警告」作为稳定标识保留）。
- 文档同步：AGENTS.md 的 lint 判据一节、README 配置表、standards 06/11/12/13/18 的
  现行口径，以及 `docs/README.md` / `docs/reference-facts.md` 的门禁清单。

验证：`pnpm run lint`（单档）、`tsc --noEmit`、相关 vitest、`pnpm check:premerge` 全绿。
