/**
 * oxlint **判决配置**（#2777 PR-B：判决主体切到 oxlint）。
 *
 * 只承载「eslint 侧原先生效、且 oxlint 有对应实现」的规则，按 eslint 的实际**文件类**
 * 分三档（TS 源码 / scripts 的 js 面 / 根级 *.config.js）；severity 已按台账
 * 「一律对齐到更严一侧」处理。未列出的规则不判 —— 全量预设评估尺仍在
 * `oxlint.config.ts`，两者用途不同，别合并。
 *
 * 生成口径：eslint --print-config 的 14 份读数并集（台账
 * `log/tools/eslint-oxlint-parity.md`），逐条映射到 oxlint 规则名。PR-B 起它是
 * `pnpm run lint` 的**唯一判定口**；#3157 起 eslint 侧整体退役（`eslint.config.js`
 * 与 `lint:policy` 一并删除），这里与 `oxlint.config.ts` 是唯一的判决面。
 *
 * 三条策略守卫也从 eslint 迁到了这里（#2777）：store selector 形态与 router 只许
 * `TRPCError` 经 `eslint-js/no-restricted-syntax`，UI/features 禁直连 `drizzle-orm`
 * 经 `eslint-js/no-restricted-imports`（后者见文件尾那条 override）。
 *
 * `plugins` 必须显式列全（#2777 收尾时补上）：缺省只开 `unicorn` / `typescript` /
 * `oxc` 三个，`react` / `nextjs` / `jsx_a11y` / `import` 的规则会**静默失效** ——
 * 配置里写着、`--rules` 里却不注册，`0 诊断` 于是变成一句空话。
 *
 * 另有 2 条改由 jsPlugin 承接（`eslint-plugin-react` 的 `no-deprecated`、
 * `@next/eslint-plugin-next` 的 `no-location-assign-relative-destination`）：这条退役路线
 * 让 oxlint 侧先具备等价判据，eslint 侧随后整份下线（`tests/oxlint-jsplugin-rules.test.ts`
 * 对拍正反样本）。`react-hooks/config` 与 `gating` 不迁（空转 + 全仓 +30s，见 TS 档注释）。
 *
 * 2026-11-04 起这里不再只装 eslint 侧规则：TS 档尾部的「预设 4.7.1 免费档」批把
 * `oxlint-config-awesomeness` 已启用、且全仓 0 命中的 171 条原生规则一并抬成判决项
 * （做法与证据见该批注释），用来把风格漂移挡在提交前，而不是等评测尺事后报。
 *
 * 为什么保留文件名里的 `parity`：它是台账号（`log/tools/eslint-oxlint-parity.md`）
 * 的锚，改名会把 29 处依赖点里的文档引用全部打散；语义已由本节头更新。
 */
import { readFileSync } from "node:fs";

import { defineConfig } from "oxlint";

/** react 的实际版本（去掉 `^` / `~` 前缀）。
 *
 * `eslint-plugin-react` 的 `no-deprecated` 靠 `settings.react.version` 判「这条 API 在这个
 * 版本是否已废弃」；oxlint 只接受**具体版本号**（写 `"detect"` 会报 invalid major version），
 * 所以这里直接读 `package.json` —— 升级 react 时配置无需手改，读数由
 * `tests/oxlint-jsplugin-rules.test.ts` 与 `package.json` 对拍。 */
const REACT_VERSION = parseReactVersion();

function parseReactVersion() {
  const match = /"react"\s*:\s*"[^\d]*([\d.]+)"/.exec(
    readFileSync(new URL("package.json", import.meta.url), "utf8"),
  );
  if (match?.[1] === undefined) {
    throw new Error("package.json 里读不到 react 版本");
  }
  return match[1];
}

const STORE_SELECTOR_HOOKS = [
  "useDebugStore",
  "useLogCategoryStore",
  "useLogPanel",
  "useLogStore",
  "useMessageCenterStore",
  "useShellTabs",
  "useUpdateCheckStore",
];

const boundariesElements = [
  { type: "server", pattern: "src/server/**" },
  { type: "server", pattern: "src/lib/core/**" },
  { type: "server", pattern: "src/lib/db/**" },
  { type: "lib", pattern: "src/lib/**" },
  { type: "components", pattern: "src/components/**" },
  { type: "features", pattern: "src/features/**" },
];

const storeSelectorEntries = [
  {
    selector: `CallExpression[callee.name=/^(${STORE_SELECTOR_HOOKS.join("|")})$/] > ArrowFunctionExpression[body.type="ObjectExpression"]`,
    message:
      "store selector 里现拼对象字面量 = 每次 store 写入都返回新引用（字段没变也重渲染）。改成只返回原始值/稳定引用，或把派生下沉进 store；useShallow 是最后手段（规范 01 §1.2 / 07 §7.15.1）。",
  },
  {
    selector: `CallExpression[callee.name=/^(${STORE_SELECTOR_HOOKS.join("|")})$/] > ArrowFunctionExpression CallExpression[callee.property.name=/^(map|filter|slice|concat|sort|split)$/]`,
    message:
      "store selector 里用 .map/.filter/.slice 造新数组 = 每次求值都是新引用（字段没变也重渲染）。把它下沉进 store 或抽成 store 内的稳定切片（规范 01 §1.2）。",
  },
];

export default defineConfig({
  /* 压不住任何诊断的 disable 指令必须报出来 —— 清完存量后缺这一格，新写的死豁免
   * 会无感回流（ISSUE #3438，#3403 收尾）。落在判决配置的 options 而非 CLI 旗标：
   * 所有拿这份 config 的调用（lint:oxlint / pre-push 复算 / 平台 / eslint-gate-canary.mjs）
   * 自动同口径，不必抄第二份命令。该键属于 oxlint 的 OxlintOptions，顶层直写运行时报
   * unknown field；CLI 旗标优先级更高，两边都写等于把唯一出处拆成两份。
   * warn 与 lint 的 --deny-warnings 同场 ⇒ 死豁免退 1、干净文件退 0；正控 / 负控由
   * eslint-gate-canary.mjs 在同一趟 oxlint 调用里守住。 */
  options: { reportUnusedDisableDirectives: "warn" },
  categories: {
    correctness: "off",
    suspicious: "off",
    perf: "off",
    style: "off",
    restriction: "off",
    nursery: "off",
    pedantic: "off",
  },
  /* 原生插件**只列本文件真正用到的**：多开的插件不产生诊断，但会让「开了什么」
   * 与规则面脱节。`react` 同时承接 `react-hooks/*` 的原生别名（rules-of-hooks /
   * exhaustive-deps 等；插件名写 `jsx-a11y`，规则前缀沿用仓内的 `jsx_a11y/` 别名）。 */
  plugins: ["import", "jsx-a11y", "nextjs", "oxc", "react", "typescript", "unicorn"],
  jsPlugins: [
    { name: "boundaries", specifier: "eslint-plugin-boundaries" },
    { name: "eslint-js", specifier: "oxlint-plugin-eslint" },
    { name: "nextjs-js", specifier: "@next/eslint-plugin-next" },
    { name: "react-js", specifier: "eslint-plugin-react" },
    { name: "unused-imports", specifier: "eslint-plugin-unused-imports" },
  ],
  settings: {
    "boundaries/elements": boundariesElements,
    "import/resolver": { "eslint-import-resolver-oxc": {} },
    react: { version: REACT_VERSION },
  },
  /* ── T1 语义规则批（2026-11-04，口径见下方挂账块）────────────────────
   * 六条 T1 里开 5 条（`strict-void-return` 单独不开：981 处里 546 处是 TS 合法的
   * 「返回值函数传给 void 回调」形态，规则没有对应选项，属结构性噪声，见台账）。
   * `no-await-in-loop`（B2）已清完：逐行禁用 + 一行理由，判决面不再有该规则的文件级豁免。
   * `typescript/require-await`（B3）已清完：754 处 / 188 份全部摘 `async` 或改 `Promise.resolve(...)`，
   * 同样不再有文件级豁免。
   * 其余存量按文件挂账在下面 3 个 override 块；这里只放「新代码必须遵守」的规则本体。
   * 依据与读数：`docs/audits/2026-11-04-oxlint-t1-burndown.md`（根目录探针，2026-11-04）。 */
  rules: {
    "no-await-in-loop": "error",
    "no-use-before-define": ["error", { functions: false }],
    "eslint/prefer-named-capture-group": "error",
    "typescript/require-await": "error",
    "typescript/no-unsafe-type-assertion": "error",
  },

  overrides: [
    {
      files: ["*.config.{js,mjs,cjs}"],
      rules: {
        "import/no-anonymous-default-export": "warn",
        "jsx_a11y/alt-text": "warn",
        "jsx_a11y/aria-props": "warn",
        "jsx_a11y/aria-proptypes": "warn",
        "jsx_a11y/aria-unsupported-elements": "warn",
        "jsx_a11y/role-has-required-aria-props": "warn",
        "jsx_a11y/role-supports-aria-props": "warn",
        "nextjs/google-font-display": "error",
        "nextjs/google-font-preconnect": "error",
        "nextjs/inline-script-id": "error",
        "nextjs/next-script-for-ga": "error",
        "nextjs/no-assign-module-variable": "error",
        "nextjs/no-async-client-component": "error",
        "nextjs/no-before-interactive-script-outside-document": "error",
        "nextjs/no-css-tags": "error",
        "nextjs/no-document-import-in-page": "error",
        "nextjs/no-duplicate-head": "error",
        "nextjs/no-head-element": "error",
        "nextjs/no-head-import-in-document": "error",
        "nextjs/no-html-link-for-pages": "error",
        "nextjs/no-img-element": "error",
        "nextjs/no-page-custom-font": "error",
        "nextjs/no-script-component-in-head": "error",
        "nextjs/no-styled-jsx-in-document": "error",
        "nextjs/no-sync-scripts": "error",
        "nextjs/no-title-in-document-head": "error",
        "nextjs/no-typos": "error",
        "nextjs/no-unwanted-polyfillio": "error",
        "no-irregular-whitespace": [
          "error",
          {
            skipComments: true,
            skipJSXText: false,
            skipRegExps: false,
            skipStrings: true,
            skipTemplates: true,
          },
        ],
        "react/display-name": "error",
        "react/exhaustive-deps": "error",
        "react/jsx-key": "error",
        "react/jsx-no-comment-textnodes": "error",
        "react/jsx-no-duplicate-props": "error",
        "react/jsx-no-undef": "error",
        "react/no-children-prop": "error",
        "react/no-danger-with-children": "error",
        "react/no-direct-mutation-state": "error",
        "react/no-find-dom-node": "error",
        "react/no-is-mounted": "error",
        "react/no-render-return-value": "error",
        "react/no-string-refs": "error",
        "react/no-unescaped-entities": "error",
        "react/refs": "error",
        "react/require-render-return": "error",
        "react/rules-of-hooks": "error",
        "react/set-state-in-effect": "error",
      },
    },
    {
      files: ["scripts/**/*.{js,mjs,cjs}"],
      rules: {
        "constructor-super": "error",
        "for-direction": "error",
        "getter-return": "error",
        "import/no-anonymous-default-export": "warn",
        "jsx_a11y/alt-text": "warn",
        "jsx_a11y/aria-props": "warn",
        "jsx_a11y/aria-proptypes": "warn",
        "jsx_a11y/aria-unsupported-elements": "warn",
        "jsx_a11y/role-has-required-aria-props": "warn",
        "jsx_a11y/role-supports-aria-props": "warn",
        "nextjs/google-font-display": "error",
        "nextjs/google-font-preconnect": "error",
        "nextjs/inline-script-id": "error",
        "nextjs/next-script-for-ga": "error",
        "nextjs/no-assign-module-variable": "error",
        "nextjs/no-async-client-component": "error",
        "nextjs/no-before-interactive-script-outside-document": "error",
        "nextjs/no-css-tags": "error",
        "nextjs/no-document-import-in-page": "error",
        "nextjs/no-duplicate-head": "error",
        "nextjs/no-head-element": "error",
        "nextjs/no-head-import-in-document": "error",
        "nextjs/no-html-link-for-pages": "error",
        "nextjs/no-img-element": "error",
        "nextjs/no-page-custom-font": "error",
        "nextjs/no-script-component-in-head": "error",
        "nextjs/no-styled-jsx-in-document": "error",
        "nextjs/no-sync-scripts": "error",
        "nextjs/no-title-in-document-head": "error",
        "nextjs/no-typos": "error",
        "nextjs/no-unwanted-polyfillio": "error",
        "no-async-promise-executor": "error",
        "no-case-declarations": "error",
        "no-class-assign": "error",
        "no-compare-neg-zero": "error",
        "no-cond-assign": "error",
        "no-const-assign": "error",
        "no-constant-binary-expression": ["error", { checkRelationalComparisons: false }],
        "no-constant-condition": "error",
        "no-control-regex": "error",
        "no-debugger": "error",
        "no-delete-var": "error",
        "no-dupe-class-members": "error",
        "no-dupe-else-if": "error",
        "no-dupe-keys": "error",
        "no-duplicate-case": "error",
        "no-empty": "error",
        "no-empty-character-class": "error",
        "no-empty-pattern": "error",
        "no-empty-static-block": "error",
        "no-ex-assign": "error",
        "no-extra-boolean-cast": "error",
        "no-fallthrough": "error",
        "no-func-assign": "error",
        "no-global-assign": "error",
        "no-import-assign": "error",
        "no-invalid-regexp": "error",
        "no-irregular-whitespace": [
          "error",
          {
            skipComments: true,
            skipJSXText: false,
            skipRegExps: false,
            skipStrings: true,
            skipTemplates: true,
          },
        ],
        "no-loss-of-precision": "error",
        "no-misleading-character-class": "error",
        "no-new-native-nonconstructor": "error",
        "no-nonoctal-decimal-escape": "error",
        "no-obj-calls": "error",
        "no-prototype-builtins": "error",
        "no-redeclare": "error",
        "no-regex-spaces": "error",
        "no-self-assign": "error",
        "no-setter-return": "error",
        "no-shadow-restricted-names": "error",
        "no-sparse-arrays": "error",
        "no-this-before-super": "error",
        "no-unassigned-vars": "error",
        "no-unexpected-multiline": "error",
        "no-unreachable": "error",
        "no-unsafe-finally": "error",
        "no-unsafe-negation": "error",
        "no-unsafe-optional-chaining": ["error", { disallowArithmeticOperators: false }],
        "no-unused-labels": "error",
        "no-unused-private-class-members": "error",
        "no-unused-vars": [
          "error",
          {
            vars: "all",
            args: "after-used",
            ignoreRestSiblings: true,
            caughtErrors: "all",
            ignoreClassWithStaticInitBlock: false,
            ignoreUsingDeclarations: false,
            reportUsedIgnorePattern: false,
            argsIgnorePattern: "^_",
          },
        ],
        "no-useless-assignment": "error",
        "no-useless-backreference": "error",
        "no-useless-catch": "error",
        "no-useless-escape": "error",
        "no-with": "error",
        "preserve-caught-error": "error",
        "react/display-name": "error",
        "react/exhaustive-deps": "error",
        "react/jsx-key": "error",
        "react/jsx-no-comment-textnodes": "error",
        "react/jsx-no-duplicate-props": "error",
        "react/jsx-no-undef": "error",
        "react/no-children-prop": "error",
        "react/no-danger-with-children": "error",
        "react/no-direct-mutation-state": "error",
        "react/no-find-dom-node": "error",
        "react/no-is-mounted": "error",
        "react/no-render-return-value": "error",
        "react/no-string-refs": "error",
        "react/no-unescaped-entities": "error",
        "react/refs": "error",
        "react/require-render-return": "error",
        "react/rules-of-hooks": "error",
        "react/set-state-in-effect": "error",
        "require-yield": "error",
        "unicorn/no-new-array": "error",
        "unicorn/no-useless-length-check": "error",
        "unicorn/no-useless-spread": "error",
        "unicorn/prefer-string-starts-ends-with": "error",
        "use-isnan": "error",
        "valid-typeof": "error",
      },
    },
    {
      files: [
        "src/**/*.{ts,tsx,mts,cts}",
        "tests/**/*.{ts,tsx,mts,cts}",
        "scripts/**/*.{ts,tsx,mts,cts}",
        "e2e/**/*.{ts,tsx,mts,cts}",
        "tools/**/*.{ts,tsx,mts,cts}",
        ".storybook/**/*.{ts,tsx,mts,cts}",
        "*.config.{ts,tsx,mts,cts}",
      ],
      /* `@next/next/no-location-assign-relative-destination` 靠 `sourceCode.scopeManager`
       * 的全局作用域判 `location` 是不是全局引用；不声明这些全局名，规则会**永远不报**
       * （`isGlobalReference` 直接落空）。只落在 TS 档：`.cjs` 门禁脚本里有自造的
       * `window` / `self` 变量，声明成全局会让 `no-redeclare` 误报一片。 */
      globals: {
        document: "readonly",
        globalThis: "readonly",
        location: "readonly",
        self: "readonly",
        window: "readonly",
      },
      rules: {
        "boundaries/dependencies": [
          "error",
          {
            default: "allow",
            policies: [
              {
                from: { element: { type: "components" } },
                disallow: { to: { element: { type: "server" } } },
              },
              {
                from: { element: { type: "server" } },
                disallow: { to: { element: { type: "components" } } },
              },
              {
                from: { element: { type: "features" } },
                disallow: { to: { element: { type: "server" } } },
              },
              {
                from: { element: { type: "lib" } },
                disallow: { to: { element: { type: "components" } } },
              },
            ],
          },
        ],
        "for-direction": "error",
        "import/no-anonymous-default-export": "warn",
        "jsx_a11y/alt-text": "error",
        "jsx_a11y/anchor-has-content": "error",
        "jsx_a11y/anchor-is-valid": "error",
        "jsx_a11y/aria-activedescendant-has-tabindex": "error",
        "jsx_a11y/aria-props": "error",
        "jsx_a11y/aria-proptypes": "error",
        "jsx_a11y/aria-role": "error",
        "jsx_a11y/aria-unsupported-elements": "error",
        "jsx_a11y/autocomplete-valid": "error",
        "jsx_a11y/click-events-have-key-events": "error",
        "jsx_a11y/control-has-associated-label": "error",
        "jsx_a11y/heading-has-content": "error",
        "jsx_a11y/html-has-lang": "error",
        "jsx_a11y/iframe-has-title": "error",
        "jsx_a11y/img-redundant-alt": "error",
        "jsx_a11y/interactive-supports-focus": "error",
        "jsx_a11y/lang": "error",
        "jsx_a11y/media-has-caption": "error",
        "jsx_a11y/mouse-events-have-key-events": "error",
        "jsx_a11y/no-access-key": "error",
        "jsx_a11y/no-aria-hidden-on-focusable": "error",
        "jsx_a11y/no-distracting-elements": "error",
        "jsx_a11y/no-interactive-element-to-noninteractive-role": "error",
        "jsx_a11y/no-noninteractive-element-interactions": "error",
        "jsx_a11y/no-noninteractive-element-to-interactive-role": "error",
        "jsx_a11y/no-noninteractive-tabindex": "error",
        "jsx_a11y/no-redundant-roles": "error",
        "jsx_a11y/no-static-element-interactions": "error",
        "jsx_a11y/role-has-required-aria-props": "error",
        "jsx_a11y/role-supports-aria-props": "error",
        "jsx_a11y/scope": "error",
        "jsx_a11y/tabindex-no-positive": "error",
        /* 从 eslint 侧接过来的 4 条（#2777 退役前置）：插件名带 `-js` 后缀是 oxlint 的
         * 别名约定 —— 原生侧已有 `react` / `nextjs` 命名空间，直接同名会和内置规则冲突。 */
        "nextjs-js/no-location-assign-relative-destination": "error",
        "nextjs/google-font-display": "error",
        "nextjs/google-font-preconnect": "error",
        "nextjs/inline-script-id": "error",
        "nextjs/next-script-for-ga": "error",
        "nextjs/no-assign-module-variable": "error",
        "nextjs/no-async-client-component": "error",
        "nextjs/no-before-interactive-script-outside-document": "error",
        "nextjs/no-css-tags": "error",
        "nextjs/no-document-import-in-page": "error",
        "nextjs/no-duplicate-head": "error",
        "nextjs/no-head-element": "error",
        "nextjs/no-head-import-in-document": "error",
        "nextjs/no-html-link-for-pages": "error",
        "nextjs/no-page-custom-font": "error",
        "nextjs/no-script-component-in-head": "error",
        "nextjs/no-styled-jsx-in-document": "error",
        "nextjs/no-sync-scripts": "error",
        "nextjs/no-title-in-document-head": "error",
        "nextjs/no-typos": "error",
        "nextjs/no-unwanted-polyfillio": "error",
        "no-async-promise-executor": "error",
        "no-case-declarations": "error",
        "no-compare-neg-zero": "error",
        "no-cond-assign": "error",
        "no-constant-binary-expression": ["error", { checkRelationalComparisons: false }],
        "no-constant-condition": "error",
        "no-control-regex": "error",
        "no-debugger": "error",
        "no-delete-var": "error",
        "no-dupe-else-if": "error",
        "no-duplicate-case": "error",
        "no-empty": "error",
        "no-empty-character-class": "error",
        "no-empty-pattern": "error",
        "no-empty-static-block": "error",
        "no-ex-assign": "error",
        "no-extra-boolean-cast": "error",
        "no-fallthrough": "error",
        "no-global-assign": "error",
        "no-invalid-regexp": "error",
        "no-irregular-whitespace": [
          "error",
          {
            skipComments: true,
            skipJSXText: false,
            skipRegExps: false,
            skipStrings: true,
            skipTemplates: true,
          },
        ],
        "no-loss-of-precision": "error",
        "no-misleading-character-class": "error",
        "no-nonoctal-decimal-escape": "error",
        "no-prototype-builtins": "error",
        "no-regex-spaces": "error",
        "no-self-assign": "error",
        "no-shadow-restricted-names": "error",
        "no-sparse-arrays": "error",
        "no-unassigned-vars": "error",
        "no-unexpected-multiline": "error",
        "no-unsafe-finally": "error",
        "no-unsafe-optional-chaining": ["error", { disallowArithmeticOperators: false }],
        "no-unused-labels": "error",
        "no-unused-private-class-members": "error",
        "no-useless-assignment": "error",
        "no-useless-backreference": "error",
        "no-useless-catch": "error",
        "no-useless-escape": "error",
        "no-var": "error",
        "prefer-const": "error",
        "prefer-rest-params": "error",
        "prefer-spread": "error",
        "preserve-caught-error": "error",
        /* `react-hooks/config` 与 `react-hooks/gating` **未迁**：两引擎（ESLint `Linter`
         * 与 oxlint jsPlugin）在无 options 时都返回 0 诊断，而本仓不传编译器 options ——
         * 迁上来是纯空转；实测启用后全仓 lint 从 34s 涨到 64s（+80%），零收益。
         * 退役时随 eslint 侧一并删（依据同此段，changelog 有记录）。 */
        "react-js/no-deprecated": "error",
        "react/display-name": "error",
        "react/exhaustive-deps": "error",
        "react/jsx-key": "error",
        "react/jsx-no-comment-textnodes": "error",
        "react/jsx-no-duplicate-props": "error",
        "react/jsx-no-undef": "error",
        "react/no-children-prop": "error",
        "react/no-danger-with-children": "error",
        "react/no-direct-mutation-state": "error",
        "react/no-find-dom-node": "error",
        "react/no-is-mounted": "error",
        "react/no-render-return-value": "error",
        "react/no-string-refs": "error",
        "react/no-unescaped-entities": "error",
        "react/refs": "error",
        "react/require-render-return": "error",
        "react/rules-of-hooks": "error",
        "react/set-state-in-effect": "error",
        "require-yield": "error",
        "typescript/adjacent-overload-signatures": "error",
        "typescript/await-thenable": "error",
        "typescript/ban-ts-comment": "error",
        "typescript/ban-tslint-comment": "error",
        "typescript/class-literal-property-style": "error",
        "typescript/consistent-generic-constructors": "error",
        "typescript/consistent-indexed-object-style": "error",
        "typescript/consistent-type-assertions": "error",
        "typescript/consistent-type-imports": [
          "error",
          { prefer: "type-imports", fixStyle: "inline-type-imports" },
        ],
        "typescript/dot-notation": "error",
        "typescript/no-array-constructor": "error",
        "typescript/no-array-delete": "error",
        "typescript/no-base-to-string": "error",
        "typescript/no-confusing-non-null-assertion": "error",
        "typescript/no-duplicate-enum-values": "error",
        "typescript/no-duplicate-type-constituents": "error",
        "typescript/no-empty-function": "error",
        "typescript/no-empty-object-type": "error",
        "typescript/no-explicit-any": "error",
        "typescript/no-extra-non-null-assertion": "error",
        "typescript/no-floating-promises": "error",
        "typescript/no-for-in-array": "error",
        "typescript/no-implied-eval": "error",
        "typescript/no-inferrable-types": "error",
        "typescript/no-misused-new": "error",
        "typescript/no-misused-promises": ["error", { checksVoidReturn: { attributes: false } }],
        "typescript/no-namespace": "error",
        "typescript/no-non-null-asserted-optional-chain": "error",
        "typescript/no-redundant-type-constituents": "error",
        "typescript/no-require-imports": "error",
        "typescript/no-this-alias": "error",
        "typescript/no-unnecessary-type-assertion": "error",
        "typescript/no-unnecessary-type-constraint": "error",
        "typescript/no-unsafe-argument": "error",
        "typescript/no-unsafe-assignment": "error",
        "typescript/no-unsafe-call": "error",
        "typescript/no-unsafe-declaration-merging": "error",
        "typescript/no-unsafe-enum-comparison": "error",
        "typescript/no-unsafe-function-type": "error",
        "typescript/no-unsafe-member-access": "error",
        "typescript/no-unsafe-return": "error",
        "typescript/no-unsafe-unary-minus": "error",
        "typescript/no-unused-expressions": "error",
        "typescript/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
        "typescript/no-wrapper-object-types": "error",
        "typescript/non-nullable-type-assertion-style": "error",
        "typescript/only-throw-error": "error",
        "typescript/prefer-as-const": "error",
        "typescript/prefer-find": "error",
        "typescript/prefer-for-of": "error",
        "typescript/prefer-function-type": "error",
        "typescript/prefer-includes": "error",
        "typescript/prefer-namespace-keyword": "error",
        "typescript/prefer-nullish-coalescing": "error",
        "typescript/prefer-optional-chain": "error",
        "typescript/prefer-promise-reject-errors": "error",
        "typescript/prefer-regexp-exec": "error",
        "typescript/prefer-string-starts-ends-with": "error",
        "typescript/restrict-plus-operands": "error",
        "typescript/restrict-template-expressions": "error",
        "typescript/triple-slash-reference": "error",
        "typescript/unbound-method": "error",
        "unicorn/no-new-array": "error",
        "unicorn/no-useless-length-check": "error",
        "unicorn/no-useless-spread": "error",
        "unicorn/prefer-string-starts-ends-with": "error",
        "unused-imports/no-unused-imports": "error",
        "use-isnan": "error",
        "valid-typeof": "error",
        /* ── 预设 4.7.1「免费档」批（2026-11-04）─────────────────────────────
         * 依据 `oxlint-config-awesomeness@4.7.1`：categories 开 correctness / suspicious /
         * perf / pedantic / style 五档，规则全集与 per-rule severity 读其 dist。
         * 入选口径（全仓 --type-aware 真跑 2453 份文件）：
         *   · 预设生效、同档 0 命中（本批实测 0 诊断；56.1s ≈ 基线 56–57s，增量 <1s）；
         *   · 插件已在 `plugins` 注册（jest / vitest / jsdoc / vue / react_perf / node /
         *     promise 要先开插件，本批不碰）；
         *   · 与已有 `typescript/*` 同义（no-array-constructor / no-implied-eval /
         *     no-unused-expressions / no-throw-literal / prefer-promise-reject-errors）
         *     或预设没给选项会空转的 `eslint/id-denylist` / `id-match`，不进批。
         * 未纳入：有命中的 128 条与需要业务改动/开插件的「缓」档，清单与样本在 PR
         * 审计表。维护：再往这里加规则，先实测 0 命中；不要为了变绿在此 off。 */
        /* 预设分类 correctness（45 条） */
        "no-caller": "error",
        "no-iterator": "error",
        "no-useless-rename": "error",
        "import/default": "error",
        "import/namespace": "error",
        "oxc/bad-array-method-on-arguments": "error",
        "oxc/bad-char-at-comparison": "error",
        "oxc/bad-comparison-sequence": "error",
        "oxc/bad-match-all-arg": "error",
        "oxc/bad-min-max-func": "error",
        "oxc/bad-object-literal-comparison": "error",
        "oxc/bad-replace-all-arg": "error",
        "oxc/const-comparisons": "error",
        "oxc/double-comparisons": "error",
        "oxc/erasing-op": "error",
        "oxc/missing-throw": "error",
        "oxc/number-arg-out-of-range": "error",
        "oxc/only-used-in-recursion": "error",
        "oxc/uninvoked-array-callback": "error",
        "react/error-boundaries": "error",
        "react/forward-ref-uses-ref": "error",
        "react/incompatible-library": "error",
        "react/jsx-props-no-spread-multi": "error",
        "react/no-did-mount-set-state": "error",
        "react/no-did-update-set-state": "error",
        "react/no-this-in-sfc": "error",
        "react/no-unsafe": "error",
        "react/no-will-update-set-state": "error",
        "react/preserve-manual-memoization": "error",
        "react/set-state-in-render": "error",
        "react/static-components": "error",
        "react/use-memo": "error",
        "react/void-dom-elements-no-children": "error",
        "react/void-use-memo": "error",
        "typescript/no-meaningless-void-operator": "error",
        "typescript/no-unnecessary-parameter-property-assignment": "error",
        "typescript/no-useless-empty-export": "error",
        "unicorn/no-await-in-promise-methods": "error",
        "unicorn/no-empty-file": "error",
        "unicorn/no-invalid-fetch-options": "error",
        "unicorn/no-invalid-remove-event-listener": "error",
        "unicorn/no-single-promise-in-promise-methods": "error",
        "unicorn/no-thenable": "error",
        "unicorn/no-unnecessary-await": "error",
        "unicorn/prefer-set-size": "error",
        /* 预设分类 suspicious（22 条） */
        "block-scoped-var": "error",
        "no-extend-native": "error",
        "no-extra-bind": "error",
        "no-new": "error",
        "no-unmodified-loop-condition": "error",
        "no-useless-constructor": "error",
        "import/no-absolute-path": "error",
        "import/no-empty-named-blocks": "error",
        "import/no-self-import": "error",
        "oxc/approx-constant": "error",
        "oxc/misrefactored-assign-op": "error",
        "oxc/no-async-endpoint-handlers": "error",
        "oxc/no-this-in-exported-function": "error",
        "react/jsx-no-script-url": "error",
        "react/no-namespace": "error",
        "react/style-prop-object": "error",
        "typescript/no-generated-empty-object-type": "error",
        "unicorn/no-accessor-recursion": "error",
        "unicorn/no-array-fill-with-reference-type": "error",
        "unicorn/no-confusing-array-with": "error",
        "unicorn/no-instanceof-builtins": "error",
        "unicorn/require-post-message-target-origin": "error",
        /* 预设分类 perf（2 条） */
        "no-useless-call": "error",
        "unicorn/prefer-array-flat-map": "error",
        /* 预设分类 pedantic（34 条） */
        "accessor-pairs": "error",
        "array-callback-return": "error",
        "no-constructor-return": "error",
        "no-inner-declarations": "error",
        "no-new-wrappers": "error",
        "no-object-constructor": "error",
        "no-self-compare": "error",
        "no-warning-comments": ["error", { terms: ["@nocommit", "fixme", "todo", "xxx"] }],
        "symbol-description": "error",
        "react/checked-requires-onchange-or-readonly": "error",
        "react/jsx-no-target-blank": "error",
        "typescript/no-mixed-enums": "error",
        "typescript/prefer-enum-initializers": "error",
        "typescript/prefer-ts-expect-error": "error",
        "typescript/related-getter-setter-pairs": "error",
        "unicorn/consistent-assert": "error",
        "unicorn/consistent-empty-array-spread": "error",
        "unicorn/no-instanceof-array": "error",
        "unicorn/no-negation-in-equality-check": "error",
        "unicorn/no-new-buffer": "error",
        "unicorn/no-static-only-class": "error",
        "unicorn/no-this-assignment": "error",
        "unicorn/no-unnecessary-array-flat-depth": "error",
        "unicorn/no-unnecessary-array-splice-count": "error",
        "unicorn/no-unnecessary-slice-end": "error",
        "unicorn/no-unreadable-iife": "error",
        "unicorn/prefer-array-flat": "error",
        "unicorn/prefer-array-some": "error",
        "unicorn/prefer-date-now": "error",
        "unicorn/prefer-math-min-max": "error",
        "unicorn/prefer-prototype-methods": "error",
        "unicorn/prefer-regexp-test": "error",
        "unicorn/prefer-string-slice": "error",
        "unicorn/require-number-to-fixed-digits-argument": "error",
        /* 预设分类 style（52 条） */
        "default-case-last": "error",
        "grouped-accessor-pairs": "error",
        "guard-for-in": "error",
        "no-duplicate-imports": ["error", { allowSeparateTypeImports: true }],
        "no-extra-label": "error",
        "no-label-var": "error",
        "no-labels": "error",
        "no-lone-blocks": "error",
        "no-multi-str": "error",
        "no-new-func": "error",
        "no-return-assign": "error",
        "no-useless-computed-key": "error",
        "prefer-exponentiation-operator": "error",
        "prefer-numeric-literals": "error",
        "vars-on-top": "error",
        yoda: "error",
        "import/no-mutable-exports": "error",
        "import/no-named-default": "error",
        "react/jsx-fragments": "error",
        "react/jsx-pascal-case": "error",
        "react/no-redundant-should-component-update": "error",
        "react/prefer-es6-class": "error",
        "react/self-closing-comp": "error",
        "typescript/consistent-type-exports": "error",
        "typescript/no-empty-interface": "error",
        "typescript/no-unnecessary-qualifier": "error",
        "typescript/parameter-properties": "error",
        "typescript/prefer-readonly": "error",
        "typescript/prefer-reduce-type-parameter": "error",
        "typescript/prefer-return-this-type": "error",
        "typescript/unified-signatures": "error",
        "unicorn/consistent-date-clone": "error",
        "unicorn/consistent-template-literal-escape": "error",
        "unicorn/empty-brace-spaces": "error",
        "unicorn/explicit-timer-delay": "error",
        "unicorn/no-array-method-this-argument": "error",
        "unicorn/no-console-spaces": "error",
        "unicorn/prefer-bigint-literals": "error",
        "unicorn/prefer-class-fields": "error",
        "unicorn/prefer-classlist-toggle": "error",
        "unicorn/prefer-includes": "error",
        "unicorn/prefer-keyboard-event-key": "error",
        "unicorn/prefer-modern-dom-apis": "error",
        "unicorn/prefer-negative-index": "error",
        "unicorn/prefer-object-from-entries": "error",
        "unicorn/prefer-optional-catch-binding": "error",
        "unicorn/prefer-reflect-apply": "error",
        "unicorn/prefer-string-trim-start-end": "error",
        "unicorn/require-array-join-separator": "error",
        "unicorn/require-module-attributes": "error",
        "unicorn/switch-case-break-position": "error",
        "unicorn/throw-new-error": "error",
        /* 预设分类 restriction（15 条） */
        "no-proto": "error",
        "no-sequences": ["error", { allowInParentheses: false }],
        "import/no-amd": "error",
        "import/no-webpack-loader-syntax": "error",
        "jsx_a11y/anchor-ambiguous-text": "error",
        "oxc/bad-bitwise-operator": "error",
        "react/no-unknown-property": "error",
        "react/unsupported-syntax": "error",
        "typescript/no-non-null-asserted-nullish-coalescing": "error",
        "typescript/prefer-literal-enum-member": "error",
        "unicorn/no-abusive-eslint-disable": "error",
        "unicorn/no-length-as-slice-end": "error",
        "unicorn/no-magic-array-flat-depth": "error",
        "unicorn/no-useless-error-capture-stack-trace": "error",
        "unicorn/prefer-modern-math-apis": "error",
        /* 预设分类 nursery（1 条） */
        "no-unreachable-loop": "error",
        /* 本批共 171 条 */
        "eslint-js/no-restricted-syntax": ["error", ...storeSelectorEntries],
      },
    },
    {
      files: ["src/server/api/routers/**/*.ts"],
      excludeFiles: ["src/server/api/routers/**/*.test.ts"],
      rules: {
        "eslint-js/no-restricted-syntax": [
          "error",
          ...storeSelectorEntries,
          {
            selector: 'ThrowStatement > NewExpression[callee.name!="TRPCError"]',
            message:
              "router 里请抛 new TRPCError({ code, message })：裸 Error 会被 tRPC 归成 INTERNAL_SERVER_ERROR，客户端就分不出「不存在 / 越权 / 重名」（规范 §11.2.1 第七条、台账 E8）。",
          },
        ],
      },
    },
    {
      /* UI/features 不得直连 Drizzle orm（#2777：从 eslint 的 `no-restricted-imports`
       * 迁来）。`boundaries/dependencies` 在 pnpm 下 `module.source` 为 null 时会落空，
       * 这一档是 scoped 兜底；文案与 eslint 侧逐字一致（对拍见
       * `tests/oxlint-policy-rules.test.ts`）。 */
      files: ["src/components/**", "src/features/**"],
      rules: {
        "eslint-js/no-restricted-imports": [
          "error",
          {
            patterns: [
              {
                group: ["drizzle-orm", "drizzle-orm/*"],
                message: "UI/features 不得直接依赖 Drizzle orm,请经 src/lib/core 仓储访问数据。",
              },
            ],
          },
        ],
      },
    },
    {
      files: ["tests/helpers/**/*.{ts,tsx}"],
      rules: { "react/rules-of-hooks": "off" },
    },
    /* 实现差异（oxlint 判、eslint 不判；逐条复核后确认是 oxlint 侧误报）——
     * 观察期在闸里按文件关掉，记录进 log/tools/eslint-oxlint-parity.md。 */
    {
      // 条件对象展开 / TypedArray→Array 转换：都不是「多余的展开」。
      files: [
        "e2e/support/preflight-browser.mjs",
        "e2e/critical-flows.spec.ts",
        "src/server/api/routers/run.ts",
      ],
      rules: { "unicorn/no-useless-spread": "off" },
    },
    {
      // cursor = end + close.length 是 for-update 的下一次 indexOf 入参，oxlint 未沿循环回路追踪。
      files: ["scripts/ui-primitives-rules-p67-p86.cjs"],
      rules: { "no-useless-assignment": "off" },
    },
    {
      // (row?.x as T).y 是测试夹具里「先断言形状再取字段」的既有形态：eslint 对 TS as
      // 断言后的可选链不报，oxlint 报了。属实现差异，不是新生缺陷。
      files: [
        "src/server/api/routers/run.test.ts",
        "src/server/api/routers/generate.test.ts",
        "src/lib/production/review-types.test.ts",
      ],
      rules: { "no-unsafe-optional-chaining": "off" },
    },
    {
      files: [
        "scripts/check-docs-api.cjs",
        "scripts/check-format.cjs",
        "scripts/check-theme-colors.cjs",
        "scripts/ci-build-readout.mjs",
        "scripts/ci-toolchain-pnpm.mjs",
        "scripts/file-structure-rules.cjs",
        "src/lib/llm/video-task-util.test.ts",
        "src/lib/llm/video-task-util.ts",
        "src/lib/log/log-ansi.ts",
        "src/lib/media/materials.ts",
        "src/lib/process/executable-resolve.ts",
        "tests/ci-log.test.ts",
      ],
      rules: { "no-control-regex": "off" },
    },
    {
      /* `typescript/no-unsafe-type-assertion` 存量挂账（清账批次 `B5`）：608 份 / 1496 处 —— 根目录
       * --type-aware 探针实测（2026-11-04），不是估读。下面每行 = 一份文件 + 该文件存量处数
       * （「存量 N 处 · 清账目标 B5 · 新代码不禁用」）；名单是逐字路径而不是 glob，
       * 所以新增文件**不自动继承**豁免。清账进度见 `docs/audits/2026-11-04-oxlint-t1-burndown.md`。 */
      files: [
        "src/server/agent/run-engine.ts", // 存量 3 处 · 清账目标 B5 · 新代码不禁用
        "src/server/api/routers/generate.test.ts", // 存量 2 处 · 清账目标 B5 · 新代码不禁用
        "src/server/api/routers/llm.test.ts", // 存量 9 处 · 清账目标 B5 · 新代码不禁用
        "src/server/api/routers/llm.ts", // 存量 1 处 · 清账目标 B5 · 新代码不禁用
        "src/server/api/routers/model.test.ts", // 存量 1 处 · 清账目标 B5 · 新代码不禁用
        "src/server/api/routers/project.ts", // 存量 1 处 · 清账目标 B5 · 新代码不禁用
        "src/server/api/routers/run.test.ts", // 存量 5 处 · 清账目标 B5 · 新代码不禁用
        "src/server/api/routers/run.ts", // 存量 1 处 · 清账目标 B5 · 新代码不禁用
        "src/server/api/routers/series-generation.ts", // 存量 2 处 · 清账目标 B5 · 新代码不禁用
        "src/server/api/routers/series.test.ts", // 存量 2 处 · 清账目标 B5 · 新代码不禁用
        "src/server/api/routers/series.ts", // 存量 2 处 · 清账目标 B5 · 新代码不禁用
        "src/server/api/routers/setting.test.ts", // 存量 2 处 · 清账目标 B5 · 新代码不禁用
        "src/server/api/routers/skill.ts", // 存量 2 处 · 清账目标 B5 · 新代码不禁用
        "src/server/api/routers/task.test.ts", // 存量 1 处 · 清账目标 B5 · 新代码不禁用
        "src/server/api/routers/task.ts", // 存量 2 处 · 清账目标 B5 · 新代码不禁用
        "src/server/api/routers/workflow-list.ts", // 存量 1 处 · 清账目标 B5 · 新代码不禁用
        "src/server/api/routers/workflow-mutations.ts", // 存量 6 处 · 清账目标 B5 · 新代码不禁用
        "src/server/api/routers/workflow.test.ts", // 存量 2 处 · 清账目标 B5 · 新代码不禁用
        "src/server/api/trpc.ts", // 存量 1 处 · 清账目标 B5 · 新代码不禁用
        "src/server/db.ts", // 存量 1 处 · 清账目标 B5 · 新代码不禁用
        "src/server/film/compose-film.ts", // 存量 2 处 · 清账目标 B5 · 新代码不禁用
        "src/server/film/orchestrator.test.ts", // 存量 2 处 · 清账目标 B5 · 新代码不禁用
        "src/server/film/orchestrator.ts", // 存量 9 处 · 清账目标 B5 · 新代码不禁用
        "src/server/lib/audit.test.ts", // 存量 5 处 · 清账目标 B5 · 新代码不禁用
        "src/server/lib/request-body.test.ts", // 存量 4 处 · 清账目标 B5 · 新代码不禁用
        "src/server/mcp/workshop-mcp.test.ts", // 存量 5 处 · 清账目标 B5 · 新代码不禁用
        "src/server/mcp/workshop-mcp.ts", // 存量 1 处 · 清账目标 B5 · 新代码不禁用
        "src/server/workshop/api-channel.ts", // 存量 1 处 · 清账目标 B5 · 新代码不禁用
        "src/server/workshop/comfyui.ts", // 存量 7 处 · 清账目标 B5 · 新代码不禁用
        "src/server/workshop/draft-repository.ts", // 存量 3 处 · 清账目标 B5 · 新代码不禁用
        "src/server/workshop/llm.ts", // 存量 1 处 · 清账目标 B5 · 新代码不禁用
        "src/server/workshop/orchestrator.test.ts", // 存量 2 处 · 清账目标 B5 · 新代码不禁用
        "src/server/workshop/production-bridge.ts", // 存量 3 处 · 清账目标 B5 · 新代码不禁用
        "src/server/workshop/repository.ts", // 存量 5 处 · 清账目标 B5 · 新代码不禁用
        "tests/a11y-axe-stories.test.ts", // 存量 6 处 · 清账目标 B5 · 新代码不禁用
        "tests/a11y-rules-gate.test.ts", // 存量 2 处 · 清账目标 B5 · 新代码不禁用
        "tests/affected-launch-separation.test.ts", // 存量 1 处 · 清账目标 B5 · 新代码不禁用
        "tests/agent-index.test.ts", // 存量 1 处 · 清账目标 B5 · 新代码不禁用
        "tests/app-port-cross-language.test.ts", // 存量 1 处 · 清账目标 B5 · 新代码不禁用
        "tests/app-port-vectors-timeout-classification.test.ts", // 存量 1 处 · 清账目标 B5 · 新代码不禁用
        "tests/app-port.test.ts", // 存量 1 处 · 清账目标 B5 · 新代码不禁用
        "tests/app-service-exit-writer.test.ts", // 存量 2 处 · 清账目标 B5 · 新代码不禁用
        "tests/base-check.test.ts", // 存量 4 处 · 清账目标 B5 · 新代码不禁用
        "tests/check-a11y-rules.test.ts", // 存量 6 处 · 清账目标 B5 · 新代码不禁用
        "tests/check-app-version.test.ts", // 存量 1 处 · 清账目标 B5 · 新代码不禁用
        "tests/check-barrel-heavy-deps.test.ts", // 存量 1 处 · 清账目标 B5 · 新代码不禁用
        "tests/check-bundle-budget.test.ts", // 存量 11 处 · 清账目标 B5 · 新代码不禁用
        "tests/check-changelog-fragments.test.ts", // 存量 1 处 · 清账目标 B5 · 新代码不禁用
        "tests/check-comfyui-port-contract.test.ts", // 存量 1 处 · 清账目标 B5 · 新代码不禁用
        "tests/check-comment-headers.test.ts", // 存量 1 处 · 清账目标 B5 · 新代码不禁用
        "tests/check-commit-claims.test.ts", // 存量 3 处 · 清账目标 B5 · 新代码不禁用
        "tests/check-daily-attendance.test.ts", // 存量 3 处 · 清账目标 B5 · 新代码不禁用
        "tests/check-doc-references.test.ts", // 存量 8 处 · 清账目标 B5 · 新代码不禁用
        "tests/check-docs-api.test.ts", // 存量 1 处 · 清账目标 B5 · 新代码不禁用
        "tests/check-file-structure.test.ts", // 存量 2 处 · 清账目标 B5 · 新代码不禁用
        "tests/check-format.test.ts", // 存量 2 处 · 清账目标 B5 · 新代码不禁用
        "tests/check-gate-thresholds.test.ts", // 存量 2 处 · 清账目标 B5 · 新代码不禁用
        "tests/check-import-alias.test.ts", // 存量 1 处 · 清账目标 B5 · 新代码不禁用
        "tests/check-inline-style.test.ts", // 存量 1 处 · 清账目标 B5 · 新代码不禁用
        "tests/check-mirror-attendance.test.ts", // 存量 2 处 · 清账目标 B5 · 新代码不禁用
        "tests/check-oxlint-zero-rules.test.ts", // 存量 1 处 · 清账目标 B5 · 新代码不禁用
        "tests/check-react-updater-purity.test.ts", // 存量 1 处 · 清账目标 B5 · 新代码不禁用
        "tests/check-reformat-only.test.ts", // 存量 4 处 · 清账目标 B5 · 新代码不禁用
        "tests/check-title-bar-clearance.test.ts", // 存量 1 处 · 清账目标 B5 · 新代码不禁用
        "tests/check-tsc-artifact-hint.test.ts", // 存量 1 处 · 清账目标 B5 · 新代码不禁用
        "tests/check-ui-customizations.test.ts", // 存量 1 处 · 清账目标 B5 · 新代码不禁用
        "tests/check-ui-primitives.test.ts", // 存量 7 处 · 清账目标 B5 · 新代码不禁用
        "tests/check-void-floats.test.ts", // 存量 2 处 · 清账目标 B5 · 新代码不禁用
        "tests/ci-build-readout.test.ts", // 存量 4 处 · 清账目标 B5 · 新代码不禁用
        "tests/ci-cp936-exit.test.ts", // 存量 28 处 · 清账目标 B5 · 新代码不禁用
        "tests/ci-daily-failure-issue.test.ts", // 存量 1 处 · 清账目标 B5 · 新代码不禁用
        "tests/ci-github-mirror-push.test.ts", // 存量 5 处 · 清账目标 B5 · 新代码不禁用
        "tests/ci-github-verdict-read.test.ts", // 存量 1 处 · 清账目标 B5 · 新代码不禁用
        "tests/ci-image-plan.test.ts", // 存量 2 处 · 清账目标 B5 · 新代码不禁用
        "tests/ci-incremental-gates.test.ts", // 存量 1 处 · 清账目标 B5 · 新代码不禁用
        "tests/ci-install-deadline.test.ts", // 存量 1 处 · 清账目标 B5 · 新代码不禁用
        "tests/ci-install-deps.test.ts", // 存量 3 处 · 清账目标 B5 · 新代码不禁用
        "tests/ci-slot-apply.test.ts", // 存量 2 处 · 清账目标 B5 · 新代码不禁用
        "tests/ci-step-verdict.test.ts", // 存量 1 处 · 清账目标 B5 · 新代码不禁用
        "tests/ci-toolchain-selfcheck.test.ts", // 存量 4 处 · 清账目标 B5 · 新代码不禁用
        "tests/ci-workspace-probe.test.ts", // 存量 1 处 · 清账目标 B5 · 新代码不禁用
        "tests/ci-workspace-provenance.test.ts", // 存量 1 处 · 清账目标 B5 · 新代码不禁用
        "tests/client-bundle-node-builtins.test.ts", // 存量 2 处 · 清账目标 B5 · 新代码不禁用
        "tests/comfy-state-envelope-contract.test.ts", // 存量 2 处 · 清账目标 B5 · 新代码不禁用
        "tests/comment-language.test.ts", // 存量 3 处 · 清账目标 B5 · 新代码不禁用
        "tests/core-barrel-entry-discipline.test.ts", // 存量 1 处 · 清账目标 B5 · 新代码不禁用
        "tests/coverage-targets-exist.test.ts", // 存量 3 处 · 清账目标 B5 · 新代码不禁用
        "tests/daily-tracks.test.ts", // 存量 2 处 · 清账目标 B5 · 新代码不禁用
        "tests/db-migrate-equivalence.test.ts", // 存量 1 处 · 清账目标 B5 · 新代码不禁用
        "tests/db-migrate-noninteractive.test.ts", // 存量 2 处 · 清账目标 B5 · 新代码不禁用
        "tests/db-push-noninteractive.test.ts", // 存量 1 处 · 清账目标 B5 · 新代码不禁用
        "tests/db-schema-current.test.ts", // 存量 2 处 · 清账目标 B5 · 新代码不禁用
        "tests/declaration-readers-gate.test.ts", // 存量 1 处 · 清账目标 B5 · 新代码不禁用
        "tests/dependency-audit.test.ts", // 存量 2 处 · 清账目标 B5 · 新代码不禁用
        "tests/deps-freshness-gate.test.ts", // 存量 5 处 · 清账目标 B5 · 新代码不禁用
        "tests/dev-drive-tune.test.ts", // 存量 1 处 · 清账目标 B5 · 新代码不禁用
        "tests/dev-launcher-downstream-exit.test.ts", // 存量 1 处 · 清账目标 B5 · 新代码不禁用
        "tests/dev-launcher-port-reclaim.test.ts", // 存量 2 处 · 清账目标 B5 · 新代码不禁用
        "tests/dev-launcher-toolchain-gate.test.ts", // 存量 1 处 · 清账目标 B5 · 新代码不禁用
        "tests/dialog-backdrop-contrast.test.ts", // 存量 2 处 · 清账目标 B5 · 新代码不禁用
        "tests/dist-artifact-hygiene.test.ts", // 存量 3 处 · 清账目标 B5 · 新代码不禁用
        "tests/doc-check-hook-wiring.test.ts", // 存量 1 处 · 清账目标 B5 · 新代码不禁用
        "tests/doc-toc.test.ts", // 存量 1 处 · 清账目标 B5 · 新代码不禁用
        "tests/downstream-exit.test.ts", // 存量 1 处 · 清账目标 B5 · 新代码不禁用
        "tests/e2e-reclaim-own-fake-port.test.ts", // 存量 2 处 · 清账目标 B5 · 新代码不禁用
        "tests/e2e-run.test.ts", // 存量 6 处 · 清账目标 B5 · 新代码不禁用
        "tests/e2e-runtime-budget.test.ts", // 存量 14 处 · 清账目标 B5 · 新代码不禁用
        "tests/e2e-trpc-stub.test.ts", // 存量 7 处 · 清账目标 B5 · 新代码不禁用
        "tests/eslint-exemption-staleness.test.ts", // 存量 1 处 · 清账目标 B5 · 新代码不禁用
        "tests/executor-host-artifact.test.ts", // 存量 1 处 · 清账目标 B5 · 新代码不禁用
        "tests/executor-host-spawn.test.ts", // 存量 1 处 · 清账目标 B5 · 新代码不禁用
        "tests/executor-mode-consistency.test.ts", // 存量 1 处 · 清账目标 B5 · 新代码不禁用
        "tests/form-field-wiring-gate.test.ts", // 存量 1 处 · 清账目标 B5 · 新代码不禁用
        "tests/freshness-ledger-backend.test.ts", // 存量 1 处 · 清账目标 B5 · 新代码不禁用
        "tests/gate-executors.test.ts", // 存量 3 处 · 清账目标 B5 · 新代码不禁用
        "tests/gate-hint-targets-exist.test.ts", // 存量 1 处 · 清账目标 B5 · 新代码不禁用
        "tests/gate-repo-boilerplate-gate.test.ts", // 存量 1 处 · 清账目标 B5 · 新代码不禁用
        "tests/gate-scan-read.test.ts", // 存量 3 处 · 清账目标 B5 · 新代码不禁用
        "tests/gates-which.test.ts", // 存量 2 处 · 清账目标 B5 · 新代码不禁用
        "tests/generate-api-docs-args.test.ts", // 存量 1 处 · 清账目标 B5 · 新代码不禁用
        "tests/global-setup-cleanup.test.ts", // 存量 1 处 · 清账目标 B5 · 新代码不禁用
        "tests/helpers/a11y-effective-config.coverage.test.ts", // 存量 3 处 · 清账目标 B5 · 新代码不禁用
        "tests/helpers/a11y-effective-config.ts", // 存量 1 处 · 清账目标 B5 · 新代码不禁用
        "tests/helpers/gate-repo.ts", // 存量 1 处 · 清账目标 B5 · 新代码不禁用
        "tests/helpers/jsdom-capability.ts", // 存量 1 处 · 清账目标 B5 · 新代码不禁用
        "tests/helpers/oxlint-probe.ts", // 存量 1 处 · 清账目标 B5 · 新代码不禁用
        "tests/helpers/probe-restore.ts", // 存量 3 处 · 清账目标 B5 · 新代码不禁用
        "tests/helpers/repo-drizzle-lock.ts", // 存量 2 处 · 清账目标 B5 · 新代码不禁用
        "tests/helpers/test-db.ts", // 存量 6 处 · 清账目标 B5 · 新代码不禁用
        "tests/helpers/theme-tokens.ts", // 存量 2 处 · 清账目标 B5 · 新代码不禁用
        "tests/helpers/trpc.ts", // 存量 2 处 · 清账目标 B5 · 新代码不禁用
        "tests/helpers/wire-contract.ts", // 存量 1 处 · 清账目标 B5 · 新代码不禁用
        "tests/hook-affected-launch.test.ts", // 存量 1 处 · 清账目标 B5 · 新代码不禁用
        "tests/jsdom-capability-gate.test.ts", // 存量 1 处 · 清账目标 B5 · 新代码不禁用
        "tests/lib-layer-boundaries.test.ts", // 存量 3 处 · 清账目标 B5 · 新代码不禁用
        "tests/lib-node-only-declarations.test.ts", // 存量 1 处 · 清账目标 B5 · 新代码不禁用
        "tests/linux-env-bootstrap.test.ts", // 存量 1 处 · 清账目标 B5 · 新代码不禁用
        "tests/lockfile-diff.test.ts", // 存量 1 处 · 清账目标 B5 · 新代码不禁用
        "tests/log-run-layout.test.ts", // 存量 2 处 · 清账目标 B5 · 新代码不禁用
        "tests/merge-changelog-anchor.test.ts", // 存量 1 处 · 清账目标 B5 · 新代码不禁用
        "tests/no-platform-ci-config.test.ts", // 存量 1 处 · 清账目标 B5 · 新代码不禁用
        "tests/node-engines.test.ts", // 存量 1 处 · 清账目标 B5 · 新代码不禁用
        "tests/on-demand-duties-gate.test.ts", // 存量 2 处 · 清账目标 B5 · 新代码不禁用
        "tests/oxlint-jsplugin-rules.test.ts", // 存量 3 处 · 清账目标 B5 · 新代码不禁用
        "tests/oxlint-policy-rules.test.ts", // 存量 6 处 · 清账目标 B5 · 新代码不禁用
        "tests/postinstall-cross-platform.test.ts", // 存量 1 处 · 清账目标 B5 · 新代码不禁用
        "tests/precommit-timing.test.ts", // 存量 1 处 · 清账目标 B5 · 新代码不禁用
        "tests/premerge-check.test.ts", // 存量 2 处 · 清账目标 B5 · 新代码不禁用
        "tests/premerge-timing.test.ts", // 存量 1 处 · 清账目标 B5 · 新代码不禁用
        "tests/ps1-consistency.test.ts", // 存量 2 处 · 清账目标 B5 · 新代码不禁用
        "tests/publish-desktop-bundle.test.ts", // 存量 3 处 · 清账目标 B5 · 新代码不禁用
        "tests/qoder-ignore.test.ts", // 存量 1 处 · 清账目标 B5 · 新代码不禁用
        "tests/ratchet-update-guards.test.ts", // 存量 1 处 · 清账目标 B5 · 新代码不禁用
        "tests/remote-model-entry-wire-contract.test.ts", // 存量 1 处 · 清账目标 B5 · 新代码不禁用
        "tests/router-error-envelope.test.ts", // 存量 3 处 · 清账目标 B5 · 新代码不禁用
        "tests/scripts-typecheck-ratchet.test.ts", // 存量 7 处 · 清账目标 B5 · 新代码不禁用
        "tests/shell-gate.test.ts", // 存量 2 处 · 清账目标 B5 · 新代码不禁用
        "tests/ship-exec.test.ts", // 存量 1 处 · 清账目标 B5 · 新代码不禁用
        "tests/ship.test.ts", // 存量 4 处 · 清账目标 B5 · 新代码不禁用
        "tests/sidebar-selected-state.test.tsx", // 存量 1 处 · 清账目标 B5 · 新代码不禁用
        "tests/sidebar-state-contrast.test.ts", // 存量 1 处 · 清账目标 B5 · 新代码不禁用
        "tests/soft-assertion-gate.test.ts", // 存量 1 处 · 清账目标 B5 · 新代码不禁用
        "tests/spawn-shell-scan.test.ts", // 存量 4 处 · 清账目标 B5 · 新代码不禁用
        "tests/splash-log-scroll-follow.test.ts", // 存量 3 处 · 清账目标 B5 · 新代码不禁用
        "tests/standalone-link-repair.test.ts", // 存量 1 处 · 清账目标 B5 · 新代码不禁用
        "tests/standalone-runtime.test.ts", // 存量 1 处 · 清账目标 B5 · 新代码不禁用
        "tests/storybook-check-script.test.ts", // 存量 1 处 · 清账目标 B5 · 新代码不禁用
        "tests/storybook-component-coverage.test.ts", // 存量 1 处 · 清账目标 B5 · 新代码不禁用
        "tests/storybook-config.test.ts", // 存量 2 处 · 清账目标 B5 · 新代码不禁用
        "tests/storybook-cva-variant-source.test.ts", // 存量 1 处 · 清账目标 B5 · 新代码不禁用
        "tests/storybook-tsc-input.test.ts", // 存量 6 处 · 清账目标 B5 · 新代码不禁用
        "tests/tauri-tools-cache.test.ts", // 存量 3 处 · 清账目标 B5 · 新代码不禁用
        "tests/test-concurrency-gate.test.ts", // 存量 2 处 · 清账目标 B5 · 新代码不禁用
        "tests/test-config-inheritance.test.ts", // 存量 7 处 · 清账目标 B5 · 新代码不禁用
        "tests/test-db-schema-drift.test.ts", // 存量 4 处 · 清账目标 B5 · 新代码不禁用
        "tests/test-environment-gate.test.ts", // 存量 2 处 · 清账目标 B5 · 新代码不禁用
        "tests/test-it-each-gate.test.ts", // 存量 1 处 · 清账目标 B5 · 新代码不禁用
        "tests/test-sleep-gate.test.ts", // 存量 2 处 · 清账目标 B5 · 新代码不禁用
        "tests/test-todo-gate.test.ts", // 存量 1 处 · 清账目标 B5 · 新代码不禁用
        "tests/test-waitfor-gate.test.ts", // 存量 1 处 · 清账目标 B5 · 新代码不禁用
        "tests/theme-token-single-source.test.ts", // 存量 1 处 · 清账目标 B5 · 新代码不禁用
        "tests/trpc-surface-executors.test.ts", // 存量 1 处 · 清账目标 B5 · 新代码不禁用
        "tests/tsc-diagnostic-executors.test.ts", // 存量 4 处 · 清账目标 B5 · 新代码不禁用
        "tests/turbopack-tracing-excludes.test.ts", // 存量 1 处 · 清账目标 B5 · 新代码不禁用
        "tests/tw4-canonical-ratchet.test.ts", // 存量 1 处 · 清账目标 B5 · 新代码不禁用
        "tests/type-assertion-gate.test.ts", // 存量 1 处 · 清账目标 B5 · 新代码不禁用
        "tests/workflow-disk-sync-single-writer.test.ts", // 存量 1 处 · 清账目标 B5 · 新代码不禁用
        "tests/workshop-input-schema-derivation.test.ts", // 存量 1 处 · 清账目标 B5 · 新代码不禁用
        "scripts/session-report.mjs", // 存量 1 处 · 清账目标 B5 · 新代码不禁用
        "tests/session-report.test.ts", // 存量 1 处 · 清账目标 B5 · 新代码不禁用
      ],
      rules: { "typescript/no-unsafe-type-assertion": "off" },
    },
  ],
});
