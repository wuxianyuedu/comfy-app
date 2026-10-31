import { fixupPluginRules } from "@eslint/compat";
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import next from "eslint-config-next/core-web-vitals";
import unusedImports from "eslint-plugin-unused-imports";
import boundaries from "eslint-plugin-boundaries";
import unicorn from "eslint-plugin-unicorn";

/** 视图层做**精确订阅**的 store hook 名单（单一出处）。
 *
 *  用途见下面「视图层 store selector 形态」那段 lint。这份清单只收
 *  **zustand store 的订阅 hook** —— 判断标准是「它的回调参数是 store state、
 *  返回值的引用稳定性直接决定重渲染」。普通 React hook（`useState` / `useMemo` /
 *  `useCallback`）**不在内**，理由见那段注释。
 *
 *  新增 store 时同步加一行，`tests/store-selector-shape.test.ts` 会核清单完整性。
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

/* `eslint-plugin-jsx-a11y` 不是本仓的直接依赖（它在 `eslint-config-next` 的
 * `dependencies` 里），pnpm 的严格布局下顶层与 `import.meta.resolve` 都解析
 * 不到（符号链接的**真实路径**不在解析链上）。所以从 `next` 配置里已经装好的
 * 那个插件对象取 —— 那是 ESLint 眼中**同一个**实例（同名插件重定义会
 * ConfigError，见 `COMPAT_PLUGIN_NAMES` 那段）。用途见 `a11yRecommendedRules()`。 */
const jsxA11y = (() => {
  for (const config of next) {
    if (config.plugins?.["jsx-a11y"]) {
      return config.plugins["jsx-a11y"];
    }
  }
  throw new Error(
    "eslint-config-next 没带 jsx-a11y 插件 —— 它换结构了？" +
      "本配置的 a11yRecommendedRules() 依赖它算「官方 recommended 集合」。",
  );
})();

/* ── 扫描范围：**白名单**（Include > Exclude）──
 *
 * 「哪些文件被 lint」由两处决定，都不随业务目录增长而维护：
 *   ① 下面的 `LINT_FILES` —— 规则**只**对匹配它的文件生效（只列 TS 源码：
 *      `scripts/**` 那些 `.mjs` / `.cjs` 门禁脚本不套这里的 TS type-checked 规则，
 *      与改造前那两条「ts / tsx」glob 同口径 —— 列宽了会给它们套上 1600+ 个假错）；
 *   ② `package.json` 的 `lint` / `lint:fix` 脚本参数 —— 显式列出要扫的目录
 *      （`eslint src tests scripts e2e tools .storybook *.config.{js,mjs,cjs,ts}`），**不是** `eslint .`。
 *      ⚠️ 这一行只是**复述**，承重的那一份是 `package.json` 里的 `lint`；改那条脚本要同批改这里。
 *      （ISSUE #2614 的现场就是这行抄漏了 `.storybook` ⇒ 有人照注释读出「`.storybook` 被扫却不判」，
 *       而它一直在上面第 ① 处那份 `LINT_FILES` 里列着 —— 声明旧了会自己长出第二张单。）
 *      调用点只有一处口径：本地钩子 B 组、`scripts/quality-gate.mjs`、`quality-gate.ps1`、
 *      以及平台侧的 `ESLint 零警告` 那一格（它曾经写的是 `eslint .` —— 扫描面宽一圈、
 *      又没有 `--cache`，在全仓上跑满 20m 被平台掐断）。
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
/**
 * `eslint-plugin-jsx-a11y` 官方 `recommended` 集合 → 本仓的扁平配置形态。
 *
 * **为什么要从插件对象里读、而不是在这里抄一份规则表**：抄一份就会漂
 *（插件升版加了新规则，我们这边一个字都不会变），而这份清单的**含义**
 * 就是「跟官方 recommended 对齐」—— 那就必须由官方那份数据算出来。
 *
 * 插件对象从 `next` 配置里已经装好的那一个取：它在本仓不是直接依赖，pnpm 的
 * 严格布局下顶层 `require()` / `import.meta.resolve` 都解析不到 —— 而
 * `next` 的 plugins 里那个正是 ESLint 眼中的**同一个**实例
 *（同名插件重定义会 ConfigError，见上面 `COMPAT_PLUGIN_NAMES` 那段）。
 *
 * 三处刻意的处理：
 *   · 官方给 `"off"` 的（如 `anchor-ambiguous-text` / `label-has-for`）**不带
 *     进来** —— 带进来会在「开了没有」的判据里被算成「开着」；
 *   · 需要参数的规则（`control-has-associated-label` / `interactive-supports-focus`
 *     等）**原样带上官方那份 options** —— 少了它规则会退回默认档、结论不同；
 *   · 全部**升成 `error`**：本仓 `lint` 脚本带 `--max-warnings 0`，两者等价，
 *     但编辑器里 `error` 更醒目，且不会有人以为「warn 可以先放着」。
 */
function a11yRecommendedRules() {
  /* 第三方包的 `configs` 联合类型里含数组形态（legacy / flat 两套并存），
   * TS 从 `.rules` 上读不出它 —— 这里**只从 recommended 那一支**取，
   * 并就地收窄。收窄失败即配置出错，直接抛（不是静默给空表：那会让整条账
   * 变成「零规则全绿」，正是本批要修的那种形态）。 */
  const config = /** @type {{ rules: Record<string, unknown> }} */ (
    /** @type {unknown} */ (jsxA11y.configs?.recommended)
  );
  if (!config || typeof config.rules !== "object" || config.rules === null) {
    throw new Error(
      "jsx-a11y 的 configs.recommended 结构变了（读不到 .rules）——" +
        "本配置的 a11yRecommendedRules() 从它算出官方 recommended 集合。",
    );
  }
  /* 规则键是 `"<plugin>/<rule>"`，官方那份就是这个名字，直接用。 */
  const recommended = config.rules;
  return Object.fromEntries(
    Object.entries(recommended)
      .filter(([, setting]) => setting !== "off")
      .map(([name, setting]) => [name, Array.isArray(setting) ? ["error", setting[1]] : "error"]),
  );
}

const LINT_FILES = [
  "src/**/*.{ts,tsx,mts,cts}",
  "tests/**/*.{ts,tsx,mts,cts}",
  "scripts/**/*.{ts,tsx,mts,cts}",
  "e2e/**/*.{ts,tsx,mts,cts}",
  "tools/**/*.{ts,tsx,mts,cts}",
  // 根级工程配置里用 TS 写的那些（vitest / playwright / drizzle；eslint.config.js 自身
  // 是 .js，由下面 `...next` 那块覆盖，与改造前同口径）
  "*.config.{ts,tsx,mts,cts}",
  /* Storybook 基建（`.storybook/**`）。点目录**不在** glob 的默认展开范围里
     （TS / ESLint 都会跳过以点开头的目录），所以要显式列 —— 否则这一个目录是
     tsc 与 eslint 的双重盲区，而它里面的注入层是所有 story 的公共依赖。
     `tsconfig.json` 的 `include` 同批加了两条，理由写在那里。 */
  ".storybook/**/*.{ts,tsx,mts,cts}",
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
const COMPAT_PLUGIN_NAMES = ["react", "react-hooks", "import", "jsx-a11y", "@next/next"];

/** 同一个插件对象只包一次：同名插件在多份 config 里出现时必须指向**同一个**包装
 *  对象，否则又会触发上面那条「重定义」错误。 */
const compatPluginCache = new WeakMap();

/** @param {import("@eslint/compat").FixupPluginDefinition} plugin */
function compatPlugin(plugin) {
  const cached = compatPluginCache.get(plugin);
  if (cached) {
    return cached;
  }
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
  if (!config.languageOptions?.parser) {
    return config;
  }
  const { parser, parserOptions, ...languageOptions } = config.languageOptions;
  return { ...config, languageOptions };
}

/** 把 next 各 config 里的插件换成一圈官方兼容包装（`@eslint/compat`），并摘掉它
 *  自带的 Babel parser —— **不改**它的规则与 settings，只换掉这两样。 */
/** @param {import("@eslint/compat").FixupConfig[]} configs */
function withCompatPlugins(configs) {
  return configs.map((config) => {
    const patched = stripBabelParser(config);
    if (!patched.plugins) {
      return patched;
    }
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
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
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

      /* ── jsx-a11y：对齐插件官方的 `recommended` 集合（规范 06 §6.12）────────
       *
       * `eslint-config-next` 只给 6 条（且全是 `warn`），而插件**装着 39 条**、
       * 官方 `recommended` 有 34 条。此前 28 条是关着的 —— 于是一批真形态
       * （锚点没内容、`<video>` 没字幕轨、`autoFocus`、非原生元素上的交互）
       * 一条判据都没有，属「装了没用」那一档。本批**按官方 recommended 对齐**、
       * 并把其中能拦真站点的升成 `error`（`--max-warnings 0` 下两者等价，
       * 但 `error` 在编辑器里更醒目）。
       *
       * ⚠️ **本仓库的方言只在这里收口**（`no-autofocus` 在桌面应用里是刻意
       *   要的：对话框一打开就该把光标放进输入框；`media-has-caption` 对
       *   本基元的静音预览媒体不成立）。方言每收口一条都要登记进
       *   `scripts/.a11y-rule-ledger.json` —— 由 `scripts/check-a11y-rules.cjs`
       *   双向核对（开了没登记 = 判据睡着；登记了却没开 = 假声明）。
       *
       * 数字口径：**别在这里写死规则条数**（会漂），要看实时读数跑
       * `node scripts/check-a11y-rules.cjs --report`。
       */
      ...a11yRecommendedRules(),
      /* 第三档：**官方两份配置谁都没提到**的非废弃规则（本批补）。
       *
       * 立案现场：插件的 `recommended` / `strict` 是 `lib/index.js` 里**手写的
       * 静态清单**，不是「除废弃外全开」。实测 39 条里**有 5 条两边都没被提到**，
       * 其中两条是官方标了 ❌ deprecated（`accessible-emoji` / `no-onchange`，
       * 不提是对的），剩下三条**既非 deprecated、也非明写 off** ——
       * 也就是说「该不该开」**从来没有人决定过**，它们只是被两边的清单漏掉了。
       * 这与「recommended 里被悄悄关掉」是同一个洞的另一面：
       * 「没列进来」同样等于「没人守」。
       *
       * 三条各自的裁决（逐条登记在 scripts/.a11y-rule-ledger.json）：
       *  · `lang` 与 `no-aria-hidden-on-focusable` —— **开**。全仓实测 0 处
       *    （`layout.tsx` 已是 `<html lang="zh-CN">`、没有 aria-hidden 落在可聚焦
       *    元素上的形态），开是**零成本的真判据**：它防的是「新增一处写错」，
       *    而不是「现存有多少」。判据生效性当场核过（植入违规会报）。
       *  · `prefer-tag-over-role` —— **不开**，且不是「误报就完事」：它实测 27 处，
       *    绝大多数是 ARIA 复合控件 pattern（Base UI 的 `role="combobox"` /
       *    `listbox` / `option`、shadcn 的 `role="list"` 修 Safari 的列表语义、
       *    `role="status"` 的 live region），换成它建议的原生标签**会把控件改坏**。
       *    但它**照出了一个真缺陷族**：`role="radiogroup"` 声明了却没有方向键契约
       *    （`AppearanceSection` 两处）—— 那一族由本批收口 + §6.12 的
       *    「复合控件 ⇄ 键盘契约」口径守，不是关掉这条就了事。 */
      "jsx-a11y/lang": "error",
      "jsx-a11y/no-aria-hidden-on-focusable": "error",
      "jsx-a11y/prefer-tag-over-role": "off",

      /* 方言两档（见 §6.12 的裁决表，逐条登记在 scripts/.a11y-rule-ledger.json）：
       *  ① 项目形态与官方默认冲突 —— 桌面应用里「打开就把光标放进唯一的输入位」
       *     是要的（官方那条针对的是**页面加载时**抢焦点，会把移动端键盘顶起来）；
       *  ② 规则看不穿本仓库的转发通道 —— `Label` 的 `htmlFor` 经 `{...props}`
       *     落到 `<label>` 上，规则只读那一处 JSX，看到的永远是「没关联」。
       * 两条都由 `check-form-field-wiring.cjs`（§16.2.4.26）与 §6.12 的裁决表
       * 分别守着，不是「关掉不管」。 */
      "jsx-a11y/no-autofocus": "off",
      "jsx-a11y/label-has-associated-control": "off",
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
              message: "UI/features 不得直接依赖 Drizzle orm,请经 src/lib/core 仓储访问数据。",
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
  /* ── vitest 的 fixture 层要关掉 react-hooks/rules-of-hooks ──────────────────
   * `test.extend` 把回调的第二参叫 `use`（`async ({}, use) => { ...; await use(v) }`），
   * 而 `react-hooks/rules-of-hooks` 按**名字**判 React Hook —— 它在这个文件里
   * 对着每一个 fixture 报「React Hook "use" is called in function …」。
   *
   * 这是**误报**而不是「可以改掉的写法」：`use` 这个名字是 vitest 的 API，
   * 不能改（改了 `test.extend` 就不认）。文件级 disable 也不合适 —— 那是把
   * 真规则一起关掉，将来这个文件里真的写了个 React hook 也没人管。
   *
   * 所以按**目录**关：`tests/helpers/**` 是测试基建，天然不含 React 组件
   * （真正的组件渲染基元在 `tests/helpers/renderWithProviders.tsx`，它导出的
   * 是普通函数而不是 hook）。范围写死到这一格，别的测试文件照旧受规则保护。 */
  /* ── 视图层 store selector 形态：禁止现拼对象 / 现造新数组（ISSUE #1780）────
   *
   * zustand 的 selector 是「每次 store 写入后重新求值、用 Object.is 比较结果」的：
   * selector 里写对象字面量（`useStore((s) => ({ a: s.a, b: s.b }))`）或 `.map` /
   * `.filter` 这类造新数组的调用，**每次求值都是新引用** ⇒ 该字段没变也照样重渲染，
   * 而且 `React.memo` 在子组件上一起失效。
   *
   * 正确的两条路（见规范 01 §1.2、07 §7.15.1）：① selector 只返回原始值或 store
   * 里已固化的引用（`log-store` 的 `header` / `panel` 切片就是这么做的：把「组件读
   * 哪些状态」在 store 文件里写一次）；② 派生确实要跨字段时，把派生下沉进 store。
   * `useShallow` 是最后手段，不是第一步 —— 它只在「必须一次订阅多字段、且没法在
   * store 侧固化」时才有收益，否则只是给每次渲染多挂一层逐项比较。
   *
   * 为什么写成 lint 而不是新的 `check-*.cjs`：B 组每次提交都跑、报错直接指到行号，
   * 也不必再新增一份「会静默失效的清单」（与上面 router 错误信封那条同因）。
   *
   * ⚠️ selector 必须**按 store hook 名**限定，不能按 `/^use[A-Z]/` 泛匹配 ——
   * `useState(() => ({ ... }))` / `useMemo(() => rows.slice(0, 8), [])` 是合法且
   * 常见的写法，泛匹配会把它们全报出来（实测：本仓 `useMemo` 造对象的写法有数十处）。
   * 名字清单是**单一出处** `STORE_SELECTOR_HOOKS`，由
   * `tests/store-selector-shape.test.ts` 核「清单与仓库里真实的 zustand store 一致」，
   * 漏登记新 store 会在那里被拦下（同 `RUNTIME_SCRIPTS` 那类清单的做法）。
   */
  {
    files: LINT_FILES,
    rules: {
      "no-restricted-syntax": [
        "error",
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
      ],
    },
  },
  {
    files: ["tests/helpers/**/*.{ts,tsx}"],
    rules: {
      "react-hooks/rules-of-hooks": "off",
    },
  },
  /* ── core recommended 补齐（#2541）──────────────────────────────
   *
   * `tseslint.configs.recommended` **不含** `eslint:recommended` 的 core 面
   * （它只带 TS 等价规则 + `eslint-recommended` 的关停块）——本仓此前的
   * 「0 警」是**空集意义上的 0**：`no-control-regex` / `no-useless-escape` /
   * `no-unsafe-optional-chaining` 这批 core 规则从未跑过。实测（`@eslint/js`
   * 的 recommended 面全量跑一遍）：175 条 / 101 文件，含 1 条真 bug
   * （`"\."` 该是 `"\\."` 的 no-op replace）。
   *
   * 顺序**不能动**：`js.configs.recommended` 必须在前、下面的关停块在后 ——
   * flat config 后者覆盖前者，反了就是把 tseslint 刻意关掉的 19 条又打开
   * （与 TS 等价规则重复计费，no-undef 在 TS 文件上是纯噪音）。
   * 随 `@eslint/js` 升级新增的 core 规则会自动生效 —— 这是有意的（跟上游
   * recommended 对齐），新增档位出读数时按同批流程裁决。
   *
   * 作用面**不是**全文件而是 `LINT_FILES + scripts 的 js 面`：`.mjs` / `.cjs`
   * 门禁脚本也吃 core recommended（否则本批修过的 no-useless-escape /
   * no-regex-spaces / no-useless-assignment / preserve-caught-error /
   * no-irregular-whitespace 在 scripts 里的现场修完就没人判了），例外与选项：
   *  · `no-undef` 关停 —— scripts 在 tsc 的 checkJs 判决面里（undefined 全局由
   *    tsc 判），core 版再判一遍只会撞 Node 全局（console / process / __dirname）
   *    出 790 条纯噪音；
   *  · `no-unused-vars` 开（#2541 第二批：84 条历史死代码逐条清零后收编），
   *    两个选项各有出处：`ignoreRestSiblings` 是「rest 解构剥字段」的惯用法
   *    （check-function-length 的 `({ start, end, named, ...rest }) => rest`）；
   *    `argsIgnorePattern: "^_"` 给「接口形态的占位形参」（start.mjs 的 logLine
   *    签名，调用方按级别挑通道时才有用）。TS 面的 unused 由
   *    `@typescript-eslint/no-unused-vars` 守，不受此影响。
   */
  {
    files: [...LINT_FILES, "scripts/**/*.{js,mjs,cjs}"],
    rules: {
      ...js.configs.recommended.rules,
      "no-undef": "off",
      "no-unused-vars": ["error", { ignoreRestSiblings: true, argsIgnorePattern: "^_" }],
    },
  },
  /* `.d.ts` / `.d.mts` 手写声明文件豁免 no-unused-vars（#2541 第二批）：
   * 声明里的参数名是 API 面 documentation，本就「不使用」——
   * scripts/lockfile/lock-diff.d.mts 与 render-lock-diff.d.mts 的 16 条全是这一类。
   * 何时可收紧：无 —— 声明文件永远不会消费自己的参数。 */
  {
    files: ["scripts/**/*.d.{ts,mts,cts}"],
    rules: {
      "no-unused-vars": "off",
    },
  },
  /* unicorn **部分**收编（#2541 第三批，用户拍板「保留 unicorn 信号」）：
   * oxlint 评估（见 #2541 第五条评论）后不引第二道 gate，改为在本仓唯一的
   * eslint 门禁里按需单条引入 unicorn 规则 —— 豁免体系只有一份，规则随
   * `eslint-plugin-unicorn` 升级自动跟上游。只开 4 条，作用面与 core
   * recommended 的 scripts 档一致（LINT_FILES + scripts js 面）。
   *
   * `unicorn/no-useless-fallback-in-spread` **不开**（台账）：它拦的
   * `{...(x ?? {})}` / `{...(x || [])}` 在本仓是**刻意的防御兜底**——
   * 「这个来源可能是 null/undefined」是写在现场的 self-documentation
   * （22 条现场全在 workflow 参数接线等判据-bearing 的业务代码里），
   * 删掉运行时等价但丢信息、降防御性。何时可开：若本仓改用显式
   * `Array.isArray(x) ? x : []` 那类形态表达兜底，再评估。 */
  {
    files: [...LINT_FILES, "scripts/**/*.{js,mjs,cjs}"],
    plugins: { unicorn },
    rules: {
      "unicorn/prefer-string-starts-ends-with": "error",
      "unicorn/no-useless-spread": "error",
      "unicorn/no-new-array": "error",
      "unicorn/no-useless-length-check": "error",
    },
  },
  {
    files: LINT_FILES,
    rules: {
      /* tseslint `eslint-recommended` 接管的 19 条 core 规则：TS 等价规则在管，
       * core 版保持关停（避免 TS 文件上重复计费）。 */
      "constructor-super": "off",
      "getter-return": "off",
      "no-class-assign": "off",
      "no-const-assign": "off",
      "no-dupe-args": "off",
      "no-dupe-class-members": "off",
      "no-dupe-keys": "off",
      "no-func-assign": "off",
      "no-import-assign": "off",
      "no-new-native-nonconstructor": "off",
      "no-new-symbol": "off",
      "no-obj-calls": "off",
      "no-redeclare": "off",
      "no-setter-return": "off",
      "no-this-before-super": "off",
      "no-undef": "off",
      "no-unreachable": "off",
      "no-unsafe-negation": "off",
      "no-with": "off",
      /* 本仓用 `@typescript-eslint/no-unused-vars`（带 `^_` 豁免）接管，core 版关停。 */
      "no-unused-vars": "off",
    },
  },
  /* `no-control-regex` 文件级豁免台账（#2541 探测后抽查 6/6 全是功能而非事故）：
   * 这些文件的正则**本来就是匹配/剥离控制字符的**——文件名消毒（`\x00-\x1f`）、
   * ANSI 转义序列剥离（`\x1b`）、CI 日志控制符读数。规则要拦的「意外混入控制
   * 字符」在这些文件里是刻意行为。豁免到**文件级**而不是规则级：新增文件里
   * 真写出意外的控制字符正则时依然会被拦。何时可移除：若某文件改用非正则
   * 方案（逐字符过滤）处理控制字符，可把该文件从这里摘掉。
   * #2541 第二批顺带收编 `ci-toolchain-pnpm.mjs`：判「文本脚本 vs 二进制」的
   * `/^[\x09\x0a\x0d\x20-\x7e]{2,}$/`（ISSUE #2563 的回归现场），同一功能类。 */
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
      "tests/no-platform-ci-config.test.ts",
    ],
    rules: {
      "no-control-regex": "off",
    },
  },
  /* `no-irregular-whitespace` 选项档（#2541 探测后逐条核实 9 处现场）：
   *  · 注释里的零宽空格（U+200B）是**刻意的**：`check-tsc-diagnostic-executors.cjs`
   *    的 `**​/*.ts`（glob 拆写）、`turbopack-tracing-excludes.test.ts` 的
   *    `*​/`（防块注释提前闭合）、`app-port-vectors-…` 的 `…​.exe` —— 都是
   *    「注释里必须写出这段记号又不能让记号生效」的同一惯用法 → skipComments；
   *  · 模板串里的全角空格（U+3000）是**刻意的**：`precommit-timing.mjs` 与
   *    `use-comfy-queue.ts` 的中文输出列对齐 → skipTemplates。
   * 字符串字面量里的不规则空白默认已跳过（skipStrings 默认 true），不动。
   * 何时可收紧：若上述文件改用显式转义（`\u200b`）或放弃全角对齐，可收掉对应选项。 */
  {
    rules: {
      "no-irregular-whitespace": ["error", { skipComments: true, skipTemplates: true }],
    },
  },
  {
    linterOptions: {
      reportUnusedDisableDirectives: true,
    },
  },
);
