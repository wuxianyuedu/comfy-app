## Changed

- **ESLint 升到 v10，旧插件用官方兼容层 `@eslint/compat` 打补丁**：v10 移除了 `context.getFilename()` / `getSourceCode()` 等**插件 API**，而 `eslint-config-next@16.3.4` 引来的插件（react / react-hooks / import / jsx-a11y）还在调用它们 —— 实测直接崩在**规则加载**阶段（`Error while loading rule 'react/display-name': contextOrFilename.getFilename is not a function`），连 `drizzle.config.ts` 这种非 React 文件都跑不到，等于整仓无法 lint。

  `eslint.config.js` 因此多了一层 `withCompatPlugins()`：

  - 给这批插件过一层 `fixupPluginRules`。**刻意不包 `@typescript-eslint`**：它在 `tseslint.configs.*` 里还有一处引用，包成新对象会被 ESLint 10 判成「同名插件重定义」直接报 `ConfigError: Cannot redefine plugin "@typescript-eslint"` —— 而它本身已原生支持 v10；
  - 同一个插件对象只包一次（WeakMap 缓存）：同名插件出现在多份 config 里时必须指向**同一个**包装对象，否则同样触发上面那条「重定义」；
  - 摘掉 next 自带的 Babel parser（`eslint-config-next/parser`）：它没实现 v10 的 `scopeManager.addGlobals` 要求，`.js` 文件会崩（`.ts` 不崩，因为被 typescript-eslint 配置的 parser 覆盖了）；摘掉后这批 js / jsx / mjs 落回 ESLint 默认的 espree —— 本仓扫描范围里的 `.js` / `.mjs` 都是普通 ESM（根级配置与门禁脚本）。

- 依赖变更：`eslint` 9.39.5 → 10.11.0、`typescript-eslint` 8.69.0 → 8.70.0、新增 `@eslint/compat@2.1.1`。
- `LINT_FILES` 补上 `.mts` / `.cts`：摘掉 Babel parser 之后，`scripts/lockfile/*.d.mts` 会落回 espree 并报 `Parsing error: Unexpected token interface` —— 纳入白名单交给 typescript-eslint 的 parser。

验证：**扫描集合与升级前逐一对齐（1125 → 1125，双向差异 0）**；`pnpm run lint` 零警告、`tsc --noEmit` 通过、结构与一致性门禁全过。

## Fixed

- 记一条排查结论，免得下次走弯路：`TypeError: scopeManager.addGlobals is not a function` **不是** `@typescript-eslint` 的版本问题 —— 8.69.0 与 8.70.0 的 scope-manager 都实现了 `addGlobals`（实测核对过源码）。真正的来源是 `eslint-config-next` 自带的 Babel parser，且它只影响自己覆盖的 `js` / `jsx` / `mts` 这批文件（`.ts` / `.tsx` 被后面的 typescript-eslint 配置用自己的 parser 覆盖）。定位手法：分别 lint 一个 `.ts`、一个 `.js` —— TS 通过而 JS 崩，指向的就是 parser 而不是插件。
