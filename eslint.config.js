import { fixupPluginRules } from "@eslint/compat";
import tseslint from "typescript-eslint";
import next from "eslint-config-next/core-web-vitals";

/* ── #2777 PR-B：eslint 侧只保留 oxlint **没有等价实现**的 16 条 ────────────
 *
 * 判决主体已经切到 `oxlint.parity.config.mjs`（`pnpm run lint` 先跑 `lint:oxlint`）。
 * 本文件只剩「oxlint 补不上的那批」：两条 `no-restricted-syntax` 策略、
 * 一条 `no-restricted-imports`、12 条 `react-hooks/*`、`react/no-deprecated`、
 * `@next/next/no-location-assign-relative-destination`。
 *
 * 它**不再是**全量 eslint 配置：
 *   · 不再展开 `eslint-config-next` 的规则面（只取插件对象）；
 *   · 不再挂 tseslint 的三份预设、`@eslint/js`、unicorn、boundaries、unused-imports
 *     —— 那些都已由 oxlint parity 闸逐条接管（见台账 `log/tools/eslint-oxlint-parity.md`）；
 *   · 只对 `LINT_FILES`（TS 源码面）生效，命令是 `pnpm run lint:policy`。
 *
 * ⚠️ 别把 oxlint 已覆盖的规则加回来：同一个判决立两个执行者，下次口径不一致时
 *   没人知道该信哪一个（AGENTS 硬规则 28 ③）。
 */

/** 视图层做**精确订阅**的 store hook 名单（单一出处之一）。
 *
 *  用途见下面「视图层 store selector 形态」那段 lint。这份清单只收
 *  **zustand store 的订阅 hook** —— 判断标准是「它的回调参数是 store state、
 *  返回值的引用稳定性直接决定重渲染」。普通 React hook（`useState` / `useMemo` /
 *  `useCallback`）**不在内**。
 *
 *  `oxlint.parity.config.mjs` 里有同一份清单（那边是生效的那个闸）；
 *  `tests/store-selector-shape.test.ts` 会核两份逐字一致 + 清单与真实 store 一致。
 */
const STORE_SELECTOR_HOOKS = [
  "useDebugStore",
  "useLogCategoryStore",
  "useLogPanel",
  "useLogStore",
  "useMessageCenterStore",
  "useShellTabs",
  "useUpdateCheckStore",
];

/** store selector 两条 `no-restricted-syntax` 条目（单一出处之一）。
 *
 *  单独抽成常量是为了让 router 那份配置能**带上它们**再追加 router 自己的
 *  selector —— 扁平配置里后一个匹配对象的 `no-restricted-syntax` 会整条替换掉
 *  前一个的数组，不合并就必然「后一层把前一层盖掉」（#2777 实测：router 那条
 *  因此从未生效）。
 */
const STORE_SELECTOR_ENTRIES = [
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

/** 需要兼容包装的插件名：next 聚合配置引来、且仍在调用 ESLint 10 已移除插件 API
 *  的那几个（`react` / `react-hooks` / `@next/next`）。
 *
 *  为什么从 `eslint-config-next` 取插件对象而不是 `import` 插件包：本仓没有这三个
 *  插件的直接依赖，pnpm 严格布局下顶层解析不到；next 的 `plugins` 里那个正是同一实例。 */
const COMPAT_PLUGIN_NAMES = ["react", "react-hooks", "@next/next"];

/** 同一个插件对象只包一次：同名插件多处出现时必须指向**同一个**包装对象，
 *  否则 ESLint 10 会判定「同名插件重定义」而报 ConfigError。 */
const compatPluginCache = new WeakMap();

/**
 * @param {import("eslint").ESLint.Plugin} plugin
 * @returns {import("eslint").ESLint.Plugin}
 */
function compatPlugin(plugin) {
  const cached = compatPluginCache.get(plugin);
  if (cached) {
    return cached;
  }
  const fixed = fixupPluginRules(plugin);
  compatPluginCache.set(plugin, fixed);
  return fixed;
}

/** 从 next 的扁平数组里只取本判据要用的那三个插件对象。
 *
 *  @type {Record<string, import("eslint").ESLint.Plugin>}
 */
const plugins = (() => {
  /** @type {Record<string, import("eslint").ESLint.Plugin>} */
  const picked = {};
  for (const config of next) {
    for (const [name, plugin] of Object.entries(config.plugins ?? {})) {
      if (COMPAT_PLUGIN_NAMES.includes(name) && picked[name] === undefined) {
        picked[name] = compatPlugin(
          /** @type {import("eslint").ESLint.Plugin} */ (/** @type {unknown} */ (plugin)),
        );
      }
    }
  }
  for (const name of COMPAT_PLUGIN_NAMES) {
    if (picked[name] === undefined) {
      throw new Error(
        `eslint-config-next 没带 ${name} 插件 —— 它换结构了？本配置的 retention 集合依赖它。`,
      );
    }
  }
  return picked;
})();

export default tseslint.config(
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
  /* ── 16 条保留规则（oxlint 无等价实现）──────────────────────────────────── */
  {
    files: LINT_FILES,
    languageOptions: {
      parser: tseslint.parser,
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
  /* ── Drizzle orm 兜底：UI/features 不得直接 import drizzle-orm ──
   *  boundaries 的「外部包」匹配在 oxlint 闸里由 `boundaries/dependencies` 承担，
   *  这一条是 pnpm 下 `module.source` 为 null 时补的 scoped 兜底（保留在 eslint 侧）。 */
  {
    files: ["src/components/**", "src/features/**"],
    rules: {
      "no-restricted-imports": [
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
  /* ── 视图层 store selector 形态：禁止现拼对象 / 现造新数组（ISSUE #1780）────
   *
   * zustand 的 selector 是「每次 store 写入后重新求值、用 Object.is 比较结果」的：
   * selector 里写对象字面量或 `.map` / `.filter` 这类造新数组的调用，**每次求值都是
   * 新引用** ⇒ 该字段没变也照样重渲染。正确的两条路见规范 01 §1.2、07 §7.15.1。
   */
  {
    files: LINT_FILES,
    rules: {
      "no-restricted-syntax": ["error", ...STORE_SELECTOR_ENTRIES],
    },
  },
  /* ── router 层的错误信封只许 TRPCError（台账 E8 的防线，2026-10-01）──────────
   * 裸 `throw new Error("…")` 在 tRPC 里不是「一个 400/404」，而是
   * **INTERNAL_SERVER_ERROR**。selector 的语义与被扫存量由
   * `tests/router-error-envelope.test.ts` 守着（含「扫描面不能是空的」那一条）。
   *
   * ⚠️ 这份对象必须排在 store selector 那份**之后**：扁平配置里后一个匹配对象的
   * `no-restricted-syntax` 会**整条替换**前一个的数组。所以这里显式带上
   * `STORE_SELECTOR_ENTRIES` 再追加 router 那条 —— 两层才同时生效。
   *
   * `*.test.ts` 排除在外：测试夹具要模拟「下游抛裸 Error」来断言信封。
   */
  {
    files: ["src/server/api/routers/**/*.ts"],
    ignores: ["src/server/api/routers/**/*.test.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        ...STORE_SELECTOR_ENTRIES,
        {
          selector: 'ThrowStatement > NewExpression[callee.name!="TRPCError"]',
          message:
            "router 里请抛 new TRPCError({ code, message })：裸 Error 会被 tRPC 归成 INTERNAL_SERVER_ERROR，客户端就分不出「不存在 / 越权 / 重名」（规范 §11.2.1 第七条、台账 E8）。",
        },
      ],
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
);
