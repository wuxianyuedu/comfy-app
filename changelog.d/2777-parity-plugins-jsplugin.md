## Changed

#2777 PR-1：补全 oxlint 判决配置的 `plugins`，修好 72 条规则静默失效；`react/no-deprecated`
与 `@next/next/no-location-assign-relative-destination` 改由 jsPlugin 承接（eslint 侧本 PR 不动）。

- **根因**：`oxlint.parity.config.mjs` / `oxlint.config.ts` 都没写 `plugins`，oxlint 只默认启用
  `unicorn` / `typescript` / `oxc`，`react` / `nextjs` / `jsx_a11y` / `import` 的规则**注册了却没跑**。
  补全后全仓启用的规则数 **134 → 208**（`--rules` 与实跑口径都核过），`0 诊断` 才第一次名副其实。
- **两条 jsPlugin**：`eslint-plugin-react` 的 `no-deprecated`（`settings.react.version` 从
  `package.json` 动态读取，oxlint 不接受 `"detect"`）、`@next/eslint-plugin-next` 的
  `no-location-assign-relative-destination`（`globals` 声明 `location/window/globalThis/document/self`，
  否则 `isGlobalReference` 永远落空）。`globals` 只落在 TS 档 —— `.cjs` 门禁脚本自造
  `window` / `self`，放根级会让 `no-redeclare` 误报 10 条。
- **未迁的两条**：`react-hooks/config` 与 `gating`。两引擎（ESLint `Linter` 与 oxlint jsPlugin）
  在无 options 时均 0 诊断，本仓不传编译器 options，故为空转；启用会使全仓 lint 从 34s 涨到
  64s（+80%）且零收益。PR-2 退役时随 eslint 侧一并删。
- **8 条存量违例（插件修好后暴露，均已修）**：6 处测试里的 `react/no-children-prop` 是既有
  `oxlint-disable-next-line` 贴错行（落在 `createElement(` 行、诊断在 `children` 属性行），
  已把注释挪到属性行；`AttributeMultiSelect` 的 `role="combobox"` 补
  `aria-controls` / `aria-expanded`（绑定真实 listbox id 与 `open` 态）；`HistoryDetailModal`
  的 `<a href="/api/helper/install">` 保留原生语义并落带理由的豁免（API 端点、非页面路由）。
- 新增对拍 `tests/oxlint-jsplugin-rules.test.ts`：从真判决配置读条目 → 现生成探针 → 真跑
  oxlint CLI，断言两条规则正反样本与文案逐字；并核两份 oxlint 配置的 jsPlugin 别名、
  `globals`、文件档、react 版本与规则清单同源。

验证：`pnpm lint`（两档）、`tsc --noEmit`、相关 vitest、`pnpm check:premerge` 全绿；
全仓 208 条规则 0 诊断。
