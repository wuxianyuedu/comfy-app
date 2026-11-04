import nextPlugin from "@next/eslint-plugin-next";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import tsParser from "@typescript-eslint/parser";

/* ── #2777 PR-B：eslint 侧只保留 oxlint **没有等价实现**的 14 条 ────────────
 *
 * 判决主体已经切到 `oxlint.parity.config.mjs`（`pnpm run lint` 先跑 `lint:oxlint`）。
 * 本文件只剩「oxlint 补不上的那批」：12 条 `react-hooks/*`、`react/no-deprecated`、
 * `@next/next/no-location-assign-relative-destination`。
 *
 * 三条策略守卫（store selector 形态、router 只许 `TRPCError`、UI/features 禁直连
 * Drizzle orm）已随 #2777 迁到 oxlint jsPlugin：前两条经 `eslint-js/no-restricted-syntax`、
 * 第三条经 `eslint-js/no-restricted-imports`，条目与判据面见 `oxlint.parity.config.mjs`
 * （对拍用例 `tests/oxlint-policy-rules.test.ts`）。
 *
 * 它**不再是**全量 eslint 配置：
 *   · 只 `import` 三个插件包（`@next/eslint-plugin-next` / `eslint-plugin-react` /
 *     `eslint-plugin-react-hooks`）与 `@typescript-eslint/parser`，不再经
 *     `eslint-config-next` 中转、也不再挂 `@eslint/js` / tseslint 预设 / unicorn /
 *     boundaries / unused-imports —— 那些都已由 oxlint 判决配置逐条接管
 *     （台账 `log/tools/eslint-oxlint-parity.md`）；
 *   · 只对 `LINT_FILES`（TS 源码面）生效，命令是 `pnpm run lint:policy`。
 *
 * ── 复审条件（#2777 收尾约定）─────────────────────────────────────
 * oxlint 支持 `react-hooks/*` 的等价实现（React Compiler 那 12 条）后，本文件那 12 条
 * 即可删；`react/no-deprecated` 与 `@next/next/no-location-assign-relative-destination`
 * 同理。等这些都不需要了，**这个文件和 `lint:policy` 档一起删**，而不是继续挂着。
 *
 * ⚠️ 别把 oxlint 已覆盖的规则加回来：同一个判决立两个执行者，下次口径不一致时
 *   没人知道该信哪一个（AGENTS 硬规则 28 ③）。
 */

/* ── 扫描范围：**白名单**（Include > Exclude）──
 *
 * 规则**只**对匹配 `LINT_FILES` 的文件生效（只列 TS 源码面：`scripts/**` 那些
 * `.mjs` / `.cjs` 门禁脚本由 oxlint parity 闸的 scripts 档判）。
 * 命令侧的目录参数收在 `package.json` 的 `lint:policy` 里。
 */
const LINT_FILES = [
  "src/**/*.{ts,tsx,mts,cts}",
  "tests/**/*.{ts,tsx,mts,cts}",
  "scripts/**/*.{ts,tsx,mts,cts}",
  "e2e/**/*.{ts,tsx,mts,cts}",
  "tools/**/*.{ts,tsx,mts,cts}",
  // 根级工程配置里用 TS 写的那些（vitest / playwright / drizzle）
  "*.config.{ts,tsx,mts,cts}",
  /* Storybook 基建（`.storybook/**`）。点目录**不在** glob 的默认展开范围里
     （TS / ESLint 都会跳过以点开头的目录），所以要显式列 —— 否则这一个目录是
     tsc 与 lint 的双重盲区，而它里面的注入层是所有 story 的公共依赖。 */
  ".storybook/**/*.{ts,tsx,mts,cts}",
];

/** 三个插件对象直接在 `package.json` 里声明为 devDependency 后 `import` 进来
 *  （#2777 PR-C：不再经 `eslint-config-next` 中转，也不再需要 `@eslint/compat`
 *  的 `fixupPluginRules` —— 这三个版本都已原生适配 ESLint 10，实测能跑）。 */
const plugins = {
  react,
  "react-hooks": reactHooks,
  "@next/next": nextPlugin,
};

export default [
  {
    ignores: [
      // 构建产物与第三方目录（固定坐标）
      "**/node_modules/**",
      "**/node_modules.old/**",
      "**/.pnpm-store/**",
      "**/.cache/**",
      ".next/**",
      "out/**",
      "dist/**",
      "coverage/**",
      "storybook-static/**",
      "test-results/**",
      "playwright-report/**",
      // 生成代码（在白名单目录内，必须显式排除）
      "src/generated/**",
      "generated/**",
      "public/generated/**",
      "docs/api/**",
      // 打包 / 交叉编译产物
      "start-tauri*/**",
      "build-launcher*/**",
      "src-tauri/**",
    ],
  },
  /* ── 14 条保留规则（oxlint 无等价实现）──────────────────────────────────── */
  {
    files: LINT_FILES,
    languageOptions: {
      parser: tsParser,
      parserOptions: { ecmaFeatures: { jsx: true }, sourceType: "module" },
    },
    plugins,
    settings: { react: { version: "detect" } },
    rules: {
      /* React Compiler 那族（oxlint 只实现 rules-of-hooks / exhaustive-deps /
       * refs / set-state-in-effect 四条，其余 12 条留在 eslint 侧）。 */
      "react-hooks/config": "error",
      "react-hooks/error-boundaries": "error",
      "react-hooks/gating": "error",
      "react-hooks/globals": "error",
      "react-hooks/immutability": "error",
      "react-hooks/incompatible-library": "warn",
      "react-hooks/preserve-manual-memoization": "error",
      "react-hooks/purity": "error",
      "react-hooks/set-state-in-render": "error",
      "react-hooks/static-components": "error",
      "react-hooks/unsupported-syntax": "warn",
      "react-hooks/use-memo": "error",
      "react/no-deprecated": "error",
      "@next/next/no-location-assign-relative-destination": "error",
    },
  },
  /* 兜底匹配：`lint:policy` 按目录扫描时会带上 `.js` / `.mjs` / `.cjs`
   * （ESLint 对「没有任何匹配配置的显式文件」会发警告）。给它们一个空规则块，
   * 让这些文件**被跳过判据**而不是被判「没配置」。 */
  {
    files: ["**/*.{js,mjs,cjs,jsx,mdx}"],
  },
  {
    linterOptions: {
      reportUnusedDisableDirectives: true,
    },
  },
];
