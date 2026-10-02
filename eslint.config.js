import { fixupPluginRules } from "@eslint/compat";
import tseslint from "typescript-eslint";
import next from "eslint-config-next/core-web-vitals";
import unusedImports from "eslint-plugin-unused-imports";
import boundaries from "eslint-plugin-boundaries";

/* ── 扫描范围：**白名单**（Include > Exclude）──
 *
 * 「哪些文件被 lint」由两处决定，都不随业务目录增长而维护：
 *   ① 下面的 `LINT_FILES` —— 规则**只**对匹配它的文件生效（只列 TS 源码：
 *      `scripts/**` 那些 `.mjs` / `.cjs` 门禁脚本不套这里的 TS type-checked 规则，
 *      与改造前那两条「ts / tsx」glob 同口径 —— 列宽了会给它们套上 1600+ 个假错）；
 *   ② `package.json` 的 `lint` / `lint:fix` 脚本参数 —— 显式列出要扫的目录
 *      （`eslint src tests scripts e2e tools *.config.*`），**不是** `eslint .`。
 *
 * 新增一个目录（草稿目录 `_scratch/`、临时实验目录…）默认**不被扫**：它既不在
 * ① 也不在 ②，不必改这个文件，也不必往任何忽略清单里补一行。
 *
 * ⚠️ **别写「先用一条忽略所有文件的 glob 关掉整个世界、再用 `files` 白名单打开
 * 要扫的目录」**：ESLint 的**全局 ignores 优先于 `files`**，被它命中的文件不会
 * 被任何 `files` 重新打开（实测报 `File ignored because of a matching ignore
 * pattern`）。那样写等于什么都不扫 —— 门禁全绿而实际没有任何检查，比漏报更危险。
 *（本注释刻意不写出那条 glob 的字面量：它在块注释里会含 `星号 + 斜杠`，提前把
 * 注释闭合掉 —— `ui/use-enter-commit` 的文件头记录过同一个坑。）
 *
 * 因此下面的 `ignores` 只放两类**固定坐标**（构建产物与生成代码），不是一份
 * 「发现新目录就补一行」的清单。
 *
 * 另外：eslint 的 `--cache-strategy content` 也收在 `lint` 脚本里（缓存键含
 * 「文件内容 + 解析后的 config」）—— `mtime` 策略下 `git checkout` / `stash` /
 * `pull` / `prettier --write` 这类「只动时间戳」的操作会让缓存大面积失效，而
 * 升级 eslint / typescript-eslint 之后要手动删一次 `node_modules/.cache/eslint`
 *（插件实现变更不在缓存键里，这是 `--cache` 的已知边界）。
 */
const LINT_FILES = [
  "src/**/*.{ts,tsx,mts,cts}",
  "tests/**/*.{ts,tsx,mts,cts}",
  "scripts/**/*.{ts,tsx,mts,cts}",
  "e2e/**/*.{ts,tsx,mts,cts}",
  "tools/**/*.{ts,tsx,mts,cts}",
  // 根级工程配置里用 TS 写的那些（vitest / playwright / drizzle；eslint.config.js 自身
  // 是 .js，由下面 `...next` 那块覆盖，与改造前同口径）
  "*.config.{ts,tsx,mts,cts}",
];

/** 需要兼容包装的插件名：next 聚合配置引来、且仍在调用 ESLint 10 已移除插件 API
 *  的那几个。
 *
 *  ESLint 10 移除了 `context.getFilename()` / `getSourceCode()` 等**插件 API**，
 *  `eslint-config-next@16.3.4` 引来的插件还在调用它们 —— 实测直接崩在**规则加载**
 *  阶段（`TypeError: Error while loading rule 'react/display-name':
 *  contextOrFilename.getFilename is not a function`），连 `drizzle.config.ts` 这种
 *  非 React 文件都跑不到，等于整仓无法 lint。
 *
 *  **刻意不含 `@typescript-eslint`**：它在 `tseslint.configs.*` 那批配置里还有一处
 *  引用，包成新对象会让 ESLint 10 判定「同名插件重定义」而直接报
 *  `ConfigError: Cannot redefine plugin "@typescript-eslint"`；而它本身已原生支持
 *  v10，不需要补。以后若在 v10 下崩在某个 `xxx/yyy` 规则上，把 `xxx` 加进来即可。
 *
 *  为什么不用 `eslint-plugin-import-x` 替换 `eslint-plugin-import`：后者是 next
 *  聚合配置的传递依赖，规则名是 `import/*`，换包名会让 next 里那批规则找不到插件；
 *  在其外包一层 fixup 是等价且更小的改动。 */
const COMPAT_PLUGIN_NAMES = [
  "react",
  "react-hooks",
  "import",
  "jsx-a11y",
  "@next/next",
];

/** 同一个插件对象只包一次：同名插件在多份 config 里出现时必须指向**同一个**包装
 *  对象，否则又会触发上面那条「重定义」错误。 */
const compatPluginCache = new WeakMap();

/** @param {import("@eslint/compat").FixupPluginDefinition} plugin */
function compatPlugin(plugin) {
  const cached = compatPluginCache.get(plugin);
  if (cached) return cached;
  const fixed = fixupPluginRules(plugin);
  compatPluginCache.set(plugin, fixed);
  return fixed;
}

/** 摘掉 next 自带的 Babel parser（`eslint-config-next/parser`）。
 *
 *  它没跟上 ESLint 10 的 `scopeManager.addGlobals` 要求 —— 实测
 *  `pnpm exec eslint postcss.config.js` 直接崩（`TypeError: scopeManager.addGlobals
 *  is not a function`），而 .ts / .tsx 不受影响：那批文件被后面的 typescript-eslint
 *  配置用自己的 parser 覆盖了，所以只有 `.js` 这条路径踩到它。
 *
 *  摘掉之后这批 js / jsx / mjs 文件落回 ESLint 默认的 espree —— 本仓扫描范围里的
 *  `.js` / `.mjs` 都是普通 ESM（根级配置与门禁脚本），espree 足够。`parserOptions`
 *  里是 Babel 专用的 `requireConfigFile` / `babelOptions`，一并摘掉。 */
/** @param {import("@eslint/compat").FixupConfig} config */
function stripBabelParser(config) {
  if (!config.languageOptions?.parser) return config;
  const { parser, parserOptions, ...languageOptions } = config.languageOptions;
  return { ...config, languageOptions };
}

/** 把 next 各 config 里的插件换成一圈官方兼容包装（`@eslint/compat`），并摘掉它
 *  自带的 Babel parser —— **不改**它的规则与 settings，只换掉这两样。 */
/** @param {import("@eslint/compat").FixupConfig[]} configs */
function withCompatPlugins(configs) {
  return configs.map((config) => {
    const patched = stripBabelParser(config);
    if (!patched.plugins) return patched;
    return {
      ...patched,
      plugins: Object.fromEntries(
        Object.entries(patched.plugins).map(([name, plugin]) => [
          name,
          COMPAT_PLUGIN_NAMES.includes(name) ? compatPlugin(plugin) : plugin,
        ]),
      ),
    };
  });
}

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
      // 打包 / 交叉编译产物：PyInstaller（start-tauri*/、build-launcher*/）与 Tauri
      // （src-tauri/**）下可能有海量 JS；误跑 `eslint .` 时这些 walk 会拖死甚至崩
      "start-tauri*/**",
      "build-launcher*/**",
      "src-tauri/**",
    ],
  },

  // eslint-config-next@16 已改为扁平（flat）配置，直接导出配置数组。
  // 旧写法用 FlatCompat.extends() 去加载它会触发 config-validator 对含
  // 插件/函数的扁平对象做 JSON 序列化，从而 TypeError: Converting circular
  // structure to JSON。这里直接展开扁平数组，绕开该崩溃。
  // 展开前过一层 `withCompatPlugins`（ESLint 10 的插件 API 兼容包装，见上面说明）。
  ...withCompatPlugins(next),
  {
    files: LINT_FILES,
    extends: [
      ...tseslint.configs.recommended,
      ...tseslint.configs.recommendedTypeChecked,
      ...tseslint.configs.stylisticTypeChecked,
    ],
    languageOptions: {
      parserOptions: {
        projectService: true,
      },
    },
    plugins: {
      "unused-imports": unusedImports,
    },
    rules: {
      "unused-imports/no-unused-imports": "error",
      "@typescript-eslint/array-type": "off",
      "@typescript-eslint/consistent-type-definitions": "off",
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "inline-type-imports" },
      ],
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/require-await": "off",
      "@typescript-eslint/no-misused-promises": [
        "error",
        { checksVoidReturn: { attributes: false } },
      ],
      /* 2026-08-30：按场景豁免。项目里 6 处 <img> 承载的全是运行时动态 URL
       *  （ComfyUI 产出走 /api/images、数据集图走 /api/file/、头像可能是外部
       *  链接），且多处尺寸完全自适应（max-h-[85vh]、w-full）。next/image 需要
       *  remotePatterns 白名单，自适应尺寸还得改写成 fill + 定位容器；而这些
       *  产出图本身已是压缩后的 jpg/webp，优化收益接近于零，反而多一次服务端
       *  图片处理开销。故在此关闭本规则——新增静态资源图（logo、插图）时仍应
       *  优先使用 next/image。 */
      "@next/next/no-img-element": "off",
    },
  },
  // ── 分层边界（2026-09-02）：用 eslint-plugin-boundaries 强制 前端/数据/逻辑 分层 ──
  // server     = 数据层(src/server、仓储 src/lib/core、db 实例 src/lib/db)
  // components = UI 层       features = 逻辑层(当前仓库暂无该目录,规则预留)
  // lib        = 跨端逻辑层(src/lib 的其余部分,ISSUE #575):此前 src/lib/comfyui、
  //              workshop、film、llm 等**不属于任何 element**,靠 `default: allow`
  //              放行 —— 于是「lib 不得 import components(H1 依赖倒置)」这条只写在
  //              注释与规范里,没有任何机器判据。实测确有两处倒置悄悄存在。
  // 顺序:更具体的 src/lib/core、src/lib/db 必须排在 src/lib/** 之前,
  //      否则它们会被按 lib 归类,数据层的既有约束(server→components 禁止)随之失效。
  // 说明:src/lib/comfyui、src/lib/film、src/lib/llm 含 client-safe 的 types/helpers,
  //       不整体划入 server,避免误伤组件对它们的合法 import。
  // Drizzle schema 位于 src/server/db/schema(已属 server),故 UI import schema/仓储即被
  //       components→server 拦截;UI 直引 drizzle-orm orm 包在本 pnpm 解析下 module.source
  //       为 null,无法用 module 选择器匹配,改用下方 scoped no-restricted-imports 兜底。
  {
    files: LINT_FILES,
    plugins: { boundaries },
    settings: {
      "boundaries/elements": [
        { type: "server", pattern: "src/server/**" },
        { type: "server", pattern: "src/lib/core/**" },
        { type: "server", pattern: "src/lib/db/**" },
        { type: "lib", pattern: "src/lib/**" },
        { type: "components", pattern: "src/components/**" },
        { type: "features", pattern: "src/features/**" },
      ],
    },
    rules: {
      "boundaries/dependencies": [
        "error",
        {
          default: "allow",
          policies: [
            // UI 不得 import 数据层
            {
              from: { element: { type: "components" } },
              disallow: { to: { element: { type: "server" } } },
            },
            // 反向越界:数据层不得 import UI(保证 server 不跨入 components/)
            {
              from: { element: { type: "server" } },
              disallow: { to: { element: { type: "components" } } },
            },
            // features 不得 import 数据层
            {
              from: { element: { type: "features" } },
              disallow: { to: { element: { type: "server" } } },
            },
            // 逻辑层不得 import 视图层(规范 §12.2 / ISSUE #575 的 H1 依赖倒置)。
            // lib 是被 components/app/server 共同依赖的地基,它反过来 import
            // components 会让「谁在最底层」变成循环,也让 lib 模块无法脱离
            // React 树单测。类型需要共享时下沉到 src/lib 下的类型模块。
            {
              from: { element: { type: "lib" } },
              disallow: { to: { element: { type: "components" } } },
            },
          ],
        },
      ],
    },
  },
  // ── Drizzle orm 兜底(2026-09-02)：UI/features 不得直接 import drizzle-orm ──
  // boundaries 在 pnpm 下无法匹配外部包(module.source 为 null),故用 scoped
  // no-restricted-imports 拦截 components/features 直引 orm 包(含子路径)。
  {
    files: ["src/components/**", "src/features/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["drizzle-orm", "drizzle-orm/*"],
              message:
                "UI/features 不得直接依赖 Drizzle orm,请经 src/lib/core 仓储访问数据。",
            },
          ],
        },
      ],
    },
  },
  /* ── router 层的错误信封只许 TRPCError（台账 E8 的防线，2026-10-01）──────────
   * 裸 `throw new Error("…")` 在 tRPC 里不是「一个 400/404」，而是
   * **INTERNAL_SERVER_ERROR** —— 于是三件事同时坏：「越权与不存在同形」这条口径在
   * 状态码层没有判据（两边都 500，看着一样纯属巧合）、界面拿不到能分支的码只能显示
   * 「出错了」（硬规则 4）、一次正常点击进 `trpc_error` 警告日志（把业务分支当故障报）。
   * 判据写成 lint 而不是新的 `check-*.cjs`：B 组每次提交都跑、报错直接指到行号，
   * 也不必再新增一份「会静默失效的清单」。selector 的语义与被扫存量由
   * `tests/router-error-envelope.test.ts` 守着（含「扫描面不能是空的」那一条）。 */
  {
    files: ["src/server/api/routers/**/*.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: 'ThrowStatement > NewExpression[callee.name!="TRPCError"]',
          message:
            "router 里请抛 new TRPCError({ code, message })：裸 Error 会被 tRPC 归成 INTERNAL_SERVER_ERROR，客户端就分不出「不存在 / 越权 / 重名」（规范 §11.2.1 第七条、台账 E8）。",
        },
      ],
    },
  },
  {
    linterOptions: {
      reportUnusedDisableDirectives: true,
    },
  },
);
