import { readFileSync } from "node:fs";

import awesomeness from "oxlint-config-awesomeness";
import { defineConfig } from "oxlint";

/**
 * awesomeness 预设会把若干外部 jsPlugin 挂进来，但本仓未必逐个直接安装；
 * 单独用评估尺配置跑 oxlint 时，任一插件解析失败都会让整份配置加载失败（#3488）。
 * 评估尺只保留预设随包自带的子路径插件，并同步剥掉其余插件承载的规则/覆盖项，
 * 让 `--config oxlint.config.ts` 在当前检出可独立加载与评估。
 */
const awesomenessJsPlugins = awesomeness.jsPlugins ?? [];

const resolvableJsPlugins = awesomenessJsPlugins.filter((plugin) => {
  if (typeof plugin === "string") {
    return plugin.startsWith("oxlint-config-awesomeness/");
  }
  return plugin.specifier.startsWith("oxlint-config-awesomeness/");
});

const removedRulePrefixes = new Set<string>();
for (const plugin of awesomenessJsPlugins) {
  if (typeof plugin === "string") {
    if (plugin.startsWith("oxlint-config-awesomeness/")) {
      continue;
    }
    // 字符串形式既可能是 npm 包名（规则前缀常为去掉 `eslint-plugin-` 的短名），
    // 也可能本身就是带 scope 的规则命名空间（如 `@nkzw/eslint-plugin` -> `@nkzw/*`）。
    removedRulePrefixes.add(plugin);
    const short = plugin.replace(/^eslint-plugin-/, "");
    if (short !== plugin) {
      removedRulePrefixes.add(short);
    }
    if (plugin.startsWith("@") && plugin.includes("/")) {
      const [scope] = plugin.split("/");
      if (scope) {
        removedRulePrefixes.add(scope);
      }
    }
    continue;
  }

  if (plugin.specifier.startsWith("oxlint-config-awesomeness/")) {
    continue;
  }
  removedRulePrefixes.add(plugin.name);
}

// SAFETY: 预设规则值类型由 awesomeness 定义；这里只按规则名做过滤，不解析/改写规则值。
type PresetRules = NonNullable<(typeof awesomeness)["rules"]>;

const withoutRemovedPluginRules = (rules: PresetRules | undefined): PresetRules => {
  const entries = Object.entries(rules ?? {}).filter(([name]) => {
    for (const prefix of removedRulePrefixes) {
      if (name === prefix || name.startsWith(`${prefix}/`)) {
        return false;
      }
    }
    return true;
  });
  // SAFETY: 只按规则名过滤，未改写任何规则值；值类型仍与 awesomeness 预设一致。
  return Object.fromEntries(entries);
};

// SAFETY: awesomeness 预设来自已安装包；评估尺只剔除当前检出不可独立加载的外部 jsPlugin
// 及其规则，不改写其余预设语义。extends 接受预设配置对象，这里按原始结构做浅映射生成可独立评估版本。
const awesomenessForEval = {
  ...awesomeness,
  jsPlugins: resolvableJsPlugins,
  rules: withoutRemovedPluginRules(awesomeness.rules),
  // oxlint-disable-next-line oxc/no-map-spread -- 逐项浅拷贝 override 并替换 rules；这里保持声明式写法，避免与 prefer-object-spread 冲突。
  overrides: (awesomeness.overrides ?? []).map((override) => ({
    ...override,
    rules: withoutRemovedPluginRules(override.rules),
  })),
} as typeof awesomeness;

/** react 的实际版本（去掉 `^` / `~` 前缀）。
 *
 * `eslint-plugin-react` 的 `no-deprecated` 靠 `settings.react.version` 判「这条 API 在这个
 * 版本是否已废弃」；oxlint 只接受**具体版本号**（写 `"detect"` 会报 invalid major version）。
 * 判决配置与这份评估尺用同一段读法，读数由 `tests/oxlint-jsplugin-rules.test.ts` 对拍。 */
const REACT_VERSION = parseReactVersion();

function parseReactVersion(): string {
  const match = /"react"\s*:\s*"[^\d]*(?<version>[\d.]+)"/.exec(
    readFileSync(new URL("package.json", import.meta.url), "utf8"),
  );
  const version = match?.groups?.version;
  if (version === undefined) {
    throw new Error("package.json 里读不到 react 版本");
  }
  return version;
}

/** 视图层做**精确订阅**的 store hook 名单（单一出处，与 `oxlint.parity.config.mjs` 同口径）。
 *  <#3157 起 eslint 已退役，判决面只有这两份 oxlint 配置>：新增 store 时同步加一行，
 *  `tests/store-selector-shape.test.ts` 会核清单完整性。 */
const STORE_SELECTOR_HOOKS = [
  "useDebugStore",
  "useLogCategoryStore",
  "useLogPanel",
  "useLogStore",
  "useMessageCenterStore",
  "useShellTabs",
  "useUpdateCheckStore",
];

/* ── 分层边界（替 eslint-plugin-boundaries；oxlint 下用该原插件经 `jsPlugins` 跑，
 *  官方有 oxlint-integration 示例 / Sanity 生产配置这么干）。
 *
 *  元素表与 `oxlint.parity.config.mjs` 逐字对应（更具体的 server 子目录必须排在
 *  `src/lib/**` 之前，否则会被先按 lib 归类，server 的既有约束随之失效）。
 *  `default: "allow"` + 4 条 disallow 策略（components→server、server→components、
 *  features→server、lib→components）与现状完全等价。
 *
 *  resolver 用 `eslint-import-resolver-oxc`：不碰 TS JS API、自动读 tsconfig 的
 *  `paths`（`~/` / `@/`），把别名导入解析成真实路径再按 `elements` pattern 分类。 */
const boundariesElements = [
  { type: "server", pattern: "src/server/**" },
  { type: "server", pattern: "src/lib/core/**" },
  { type: "server", pattern: "src/lib/db/**" },
  { type: "lib", pattern: "src/lib/**" },
  { type: "components", pattern: "src/components/**" },
  { type: "features", pattern: "src/features/**" },
];

export default defineConfig({
  extends: [awesomenessForEval],
  /* 显式声明插件（不写就只开 `unicorn` / `typescript` / `oxc`，预设里其余插件的规则会
   * 静默失效）。前 9 个与预设自身的 `plugins` 逐字一致 —— 覆盖时不增不减，避免把预设
   * 没声明的插件拉进来制造噪声。
   *
   * `vitest` 是**唯一**的追加（2026-11-04）：oxlint 原生插件（73 条规则，`node_modules`
   * 里没有独立包，不需要装依赖），只在评估尺注册、**规则一条未开** —— 试跑读数与
   * 「开哪几条」的建议见 `docs/audits/2026-11-04-oxlint-t1-burndown.md` §六，等口径后再进判决面。 */
  plugins: [
    "import",
    "jsx-a11y",
    "nextjs",
    "node",
    "oxc",
    "promise",
    "react",
    "typescript",
    "unicorn",
    "vitest",
  ],
  // `eslint` 是 oxlint 原生保留名，oxlint-plugin-eslint 必须显式别名成 eslint-js。
  // eslint-plugin-boundaries 经 jsPlugins 跑（用 resolver 解析别名导入）。
  jsPlugins: [
    { name: "boundaries", specifier: "eslint-plugin-boundaries" },
    { name: "eslint-js", specifier: "oxlint-plugin-eslint" },
    { name: "nextjs-js", specifier: "@next/eslint-plugin-next" },
    { name: "react-js", specifier: "eslint-plugin-react" },
  ],
  settings: {
    // eslint-plugin-boundaries 的元素表（根级 settings）。
    "boundaries/elements": boundariesElements,
    // resolver：解析 `~/` / `@/` 别名 → 真实路径，供 boundaries 按 pattern 分类。
    "import/resolver": {
      "eslint-import-resolver-oxc": {},
    },
    react: { version: REACT_VERSION },
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
          // 数据层不得 import UI（保证 server 不跨入 components/）
          {
            from: { element: { type: "server" } },
            disallow: { to: { element: { type: "components" } } },
          },
          // features 不得 import 数据层
          {
            from: { element: { type: "features" } },
            disallow: { to: { element: { type: "server" } } },
          },
          // 逻辑层不得 import 视图层（规范 §12.2 / ISSUE #575 的 H1 依赖倒置）
          {
            from: { element: { type: "lib" } },
            disallow: { to: { element: { type: "components" } } },
          },
        ],
      },
    ],
    // 视图层 store selector 形态：禁止现拼对象 / 现造新数组（ISSUE #1780）。
    // 与 eslint 版同 selector，经 eslint-js(no-restricted-syntax) 跑。
    "eslint-js/no-restricted-syntax": [
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
    /* 组件声明形态：具名组件一律 `function` 声明，匿名 / 内联两类形态都收。
     *
     * 预设默认反着来（要求具名组件写成箭头 + 变量），在本仓等于要动 811 处 / 430 份 ——
     * 而全仓 2402 份里 99% 早就是 `function` 声明，这条口径只是把既成事实写下来。
     * `unnamedComponents` 收数组而不是单选：`function-expression` 会把
     * `memo(function X(){…})` 这一族判成违例（25 处），`arrow-function` 又会反过来把
     * `render={() => …}` 判成违例 —— 匿名那侧在 `memo` / `forwardRef` / 行内三种用法里
     * 本就没有统一形态，两种都是对的。口径与逐条读数见 ISSUE #2920。 */
    "react/function-component-definition": [
      "error",
      {
        namedComponents: "function-declaration",
        unnamedComponents: ["function-expression", "arrow-function"],
      },
    ],
    /* ── T1 语义规则批（2026-11-04，与 `oxlint.parity.config.mjs` 同步）────────
     * 判决面按**文件级挂账**把存量豁免掉了，评估尺这边**不挂账**：它本来就是
     * 「全量还剩多少」的读数面，挂账会让读数变成 0、失去评估意义。
     *
     * 开了 5 条：`no-await-in-loop`、`no-use-before-define`（`functions: false`，
     * 只判 TDZ 真隐患，不判合法的函数前向引用）、`eslint/prefer-named-capture-group`、
     * `typescript/require-await`、`typescript/no-unsafe-type-assertion`。
     * 六条里的 `typescript/strict-void-return` **没开**：981 处里 546 处是 TS 合法的
     * 「返回值函数传给 void 回调」，规则只有 `allowReturnAny` 一个选项，收不干净。
     * 逐条证据与批次见 `docs/audits/2026-11-04-oxlint-t1-burndown.md`。 */
    /* ── vitest 原生插件批（issue #3180，台账 §六）：低噪声、抓真问题那批 ──
     * `valid-expect` 必须配 `maxArgs: 2`：默认只认 1 参，会把 expect(a, b) 形态的
     * 合法双参断言成片误报（审计读数 555 处 / 137 份）。不开清单（方向反 / 误报 /
     * 噪声档）见台账 §六，这里不列。 */
    "vitest/valid-expect": ["error", { maxArgs: 2 }],
    "vitest/no-conditional-expect": "error",
    "vitest/no-conditional-tests": "error",
    "vitest/no-duplicate-hooks": "error",
    "vitest/no-focused-tests": "error",
    "vitest/no-identical-title": "error",
    "vitest/no-alias-methods": "error",
    "vitest/consistent-vitest-vi": "error",
    "vitest/valid-expect-in-promise": "error",
    "vitest/no-test-return-statement": "error",
    "vitest/require-awaited-expect-poll": "error",
    "vitest/no-mocks-import": "error",
    "vitest/no-interpolation-in-snapshots": "error",
    "vitest/no-import-node-test": "error",
    /* ── T2 结构规模类第一批（issue #3179）：max-params 先开 ──
     * `max: 5` 是实测档（2026-11-10 全仓探针：6 参 9 处 + 8 参 1 处全部清零，5 参
     * 34 处合规不动——后者集中在启动链关键脚本，签名改造风险大；收 4 是后续候选
     * 批次，见台账 §五）。complexity / max-depth / max-nested-calls 三条缓（阈值
     * 待拍，本批不开）。 */
    "eslint/max-params": ["error", { max: 5 }],
    "no-await-in-loop": "error",
    "no-use-before-define": ["error", { functions: false }],
    "eslint/prefer-named-capture-group": "error",
    "typescript/require-await": "error",
    "typescript/no-unsafe-type-assertion": "error",
  },
  /* router 层的错误信封只许 TRPCError（台账 E8 的防线）。
   * 仅作用于 routers 目录（裸 `throw new Error` 在别处合法，必须文件作用域）。
   * 根级 `settings` 不能塞 overrides 里，但 `overrides` 本身受支持。 */
  overrides: [
    {
      /* `scripts/**` 关掉 `awesomeness/no-novel-comments`（ISSUE #2924）。
       *
       * 依据是抽样而不是「嫌吵」：按目录分层抽 114 条（根 91 / launcher-core 14 /
       * base-check 4 / storybook-checks 3 / lockfile 2 / lib 1），逐条判「复述代码行为」
       * vs 「为什么 / 契约 / JSDoc 类型 / 模块头 / 禁用理由」，结果**复述型 0 条（0%）**，
       * 其余是 why/约束 28.1%、JSDoc 类型 57.0%、模块头 14.9%。门禁与取证脚本的长注释
       * 基本是判据出处、阈值实测、平台/子进程的真实现场 —— 删它们等于删掉「为什么」。
       *
       * ⚠️ 这是**示例证据**，不是永久豁免：新增脚本仍按既定口径写注释（不复述代码行为）；
       * 评审时一旦发现复述型注释即删，并在台账记一处。复述型占比回升到 30% 以上时，
       * 这一条 override 就该撤掉、改回逐处处置。 */
      files: ["scripts/**"],
      rules: {
        "awesomeness/no-novel-comments": "off",
      },
    },
    {
      /* `src/lib/**` 关掉 `awesomeness/no-novel-comments`（ISSUE #2924 第二步）。
       *
       * 同样先抽样再定策：锁定基线 `82c2a23e`，按 20 个子树等比例分层抽 **100 条**，
       * 逐条判「复述代码行为」vs「为什么 / 契约 / JSDoc 类型 / 模块头」，
       * 结果**复述型 0/100（0%）**：why/约束 71%、模块头 27%、JSDoc 类型 2%。
       * 与 scripts 的差别只在 JSDoc 类型占比（TS 的类型在签名里，长注释几乎全在讲「为什么」）。
       *
       * 例外**按子树逐个登记**（下面每条 glob 后面是「该层抽样 n / 复述 0」与该层实测处数），
       * 不写成一条 `src/lib/**`：新增子树**不自动继承**这条例外 —— 先抽样、再登记，
       * 复述型占比高于 0 的子树走「删复述」而不是登记。
       *
       * ⚠️ 这是**证据支撑的例外，不是永久豁免**：新增代码仍按既定口径写注释；
       * 评审发现复述型即删；任何子树复述型回升到 30% 以上时，撤掉它那一行 glob。 */
      files: [
        "src/lib/comfyui/**", // 抽样 29 / 复述 0（421 处）
        "src/lib/*.ts", // 抽样 18 / 复述 0（253 处，根文件）
        "src/lib/log/**", // 抽样 6 / 复述 0（97 处）
        "src/lib/process/**", // 抽样 6 / 复述 0（91 处）
        "src/lib/shell/**", // 抽样 6 / 复述 0（86 处）
        "src/lib/core/**", // 抽样 5 / 复述 0（80 处）
        "src/lib/workflow/**", // 抽样 5 / 复述 0（71 处）
        "src/lib/workshop/**", // 抽样 5 / 复述 0（70 处）
        "src/lib/media/**", // 抽样 4 / 复述 0（60 处）
        "src/lib/project-canvas/**", // 抽样 3 / 复述 0（44 处）
        "src/lib/comfy/**", // 抽样 2 / 复述 0（34 处）
        "src/lib/llm/**", // 抽样 2 / 复述 0（31 处）
        "src/lib/app-settings/**", // 抽样 2 / 复述 0（12 处）
        "src/lib/console/**", // 抽样 1 / 复述 0（22 处）
        "src/lib/production/**", // 抽样 1 / 复述 0（18 处）
        "src/lib/markdown/**", // 抽样 1 / 复述 0（16 处）
        "src/lib/drizzle-studio/**", // 抽样 1 / 复述 0（5 处）
        "src/lib/agent/**", // 抽样 1 / 复述 0（4 处）
        "src/lib/film/**", // 抽样 1 / 复述 0（2 处）
        "src/lib/db-backup/**", // 抽样 1 / 复述 0（1 处）
      ],
      rules: {
        "awesomeness/no-novel-comments": "off",
      },
    },
    {
      /* `tests/**` / `src/server/**` / `e2e/**` 关掉 `awesomeness/no-novel-comments`
       * （ISSUE #2924 的包 A2）。
       *
       * 口径与 `scripts/**`、`src/lib/**` 两批一致：先抽样再定策。锁定基线
       * `d7dac532` 的 1540 处 / 437 份，按 16 个子域分层抽 **110 条**，逐条判
       * 「复述代码行为」vs「为什么 / 契约 / 证据 / 模块头 / 测试意图」，
       * 结果**复述型 0/110（0%）**：why/约束 73%、模块头与测试意图 25%、
       * JSDoc 类型 2%。测试文件里说明「在测什么、为什么这么断言」的注释按 why 计，
       * mock 桩里的防御性说明同样保留 —— 它们正是删掉之后最难重建的那一类。
       *
       * 例外**按子域逐个登记**（每条 glob 后面是该层「抽样 n / 复述 0」与实测处数），
       * 不写成 `tests/**` / `src/server/**` / `e2e/**` 三条大 glob：新增子域**不自动继承**
       * 这条例外 —— 先抽样、再登记，复述型占比高于 0 的子域走「删复述」而不是登记。
       *
       * ⚠️ 这是**证据支撑的例外，不是永久豁免**：新代码仍按既定口径写注释；
       * 评审发现复述型即删；任何子域复述型回升到 30% 以上时，撤掉它那一行 glob。 */
      files: [
        "tests/*.{ts,tsx}", // 抽样 60 / 复述 0（1155 处，根文件）
        "tests/helpers/**", // 抽样 6 / 复述 0（109 处）
        "tests/integration/**", // 抽样 1 / 复述 0（1 处）
        "tests/stubs/**", // 抽样 1 / 复述 0（1 处）
        "e2e/*.{ts,mjs}", // 抽样 6 / 复述 0（90 处，根文件）
        "e2e/support/**", // 抽样 5 / 复述 0（72 处）
        "src/server/api/**", // 抽样 6 / 复述 0（44 处）
        "src/server/lib/**", // 抽样 4 / 复述 0（14 处）
        "src/server/film/**", // 抽样 3 / 复述 0（13 处）
        "src/server/workshop/**", // 抽样 3 / 复述 0（10 处）
        "src/server/agent/**", // 抽样 3 / 复述 0（8 处）
        "src/server/db/**", // 抽样 3 / 复述 0（7 处）
        "src/server/better-auth/**", // 抽样 3 / 复述 0（6 处）
        "src/server/*.ts", // 抽样 3 / 复述 0（5 处，根文件）
        "src/server/mcp/**", // 抽样 2 / 复述 0（3 处）
        "src/server/auth/**", // 抽样 1 / 复述 0（2 处）
      ],
      rules: {
        "awesomeness/no-novel-comments": "off",
      },
    },
    {
      /* #2924 收官包：`.storybook/**`、根配置面、`src/trpc/**`、`src/config/**`、
       * `src/(根)`、`tools/**` 关掉 `awesomeness/no-novel-comments`。
       *
       * 与前三批同一口径：全仓复扫实测 214 处 / 30 份，按**文件**分层抽 **119 条**，
       * 逐条判「复述代码行为」vs「为什么 / 契约 / 证据 / 模块头」，
       * 结果**复述型 0/119（0%）**：构建/覆盖率阈值的推导与实测留痕、配置项之间
       * 「只写一处就会静默失效」的因果、Storybook 注入层「为什么必须真数据」、
       * `src/env.js` / 启动入口的 runtime 边界，全部是删掉之后最难重建的那类。
       *
       * 例外**按文件逐个登记**（不写 `.storybook/**` / `src/trpc/**` 这类目录通配）：
       * 新增文件**不自动继承** —— 先抽样、再登记，复述型占比高于 0 的文件走「删复述」。
       * `oxlint.config.ts` / `oxlint.parity.config.mjs` 自身也在命中面里：这些例外说明
       * 注释就是「为什么」，登记而不是自删理由。
       *
       * ⚠️ 证据支撑的例外，不是永久豁免：评审发现复述型即删；任一文件复述型回升到
       * 30% 以上时，撤掉它那一行 glob。 */
      files: [
        "vitest.config.ts", // 抽样 28 / 复述 0（64 处：覆盖率门槛的实测推导与留痕）
        ".storybook/store-sources.tsx", // 抽样 7 / 复述 0（17 处）
        ".storybook/message-center-sources.tsx", // 抽样 6 / 复述 0（16 处）
        ".storybook/flow-canvas.tsx", // 抽样 6 / 复述 0（15 处）
        ".storybook/data-sources.tsx", // 抽样 5 / 复述 0（11 处）
        ".storybook/screen-frame.tsx", // 抽样 4 / 复述 0（9 处）
        ".storybook/workflow-run-sources.tsx", // 抽样 3 / 复述 0（8 处）
        ".storybook/main.ts", // 抽样 2 / 复述 0（4 处）
        ".storybook/preview.tsx", // 抽样 1 / 复述 0（3 处）
        ".storybook/app-origin-defaults.ts", // 抽样 1 / 复述 0（1 处）
        ".storybook/app-origin-reader.ts", // 抽样 1 / 复述 0（1 处）
        "next.config.js", // 抽样 5 / 复述 0（10 处：CSP / tracing 的现场与因果）
        "playwright.config.ts", // 抽样 5 / 复述 0（10 处：并发档与超时的实测来历）
        "oxlint.config.ts", // 抽样 7 / 复述 0（改前 7 处；本文件例外说明即理由）
        "oxlint.parity.config.mjs", // 抽样 6 / 复述 0（判决面与历史）
        "src/config/custom-nodes.ts", // 抽样 5 / 复述 0（5 处）
        "src/config/custom-nodes.test.ts", // 抽样 4 / 复述 0（4 处）
        "src/instrumentation.ts", // 抽样 4 / 复述 0（4 处）
        "src/proxy.ts", // 抽样 3 / 复述 0（3 处）
        "src/trpc/base-url.ts", // 抽样 3 / 复述 0（3 处）
        "src/env.js", // 抽样 2 / 复述 0（2 处）
        "src/proxy.test.ts", // 抽样 2 / 复述 0（2 处）
        "src/trpc/react.tsx", // 抽样 2 / 复述 0（2 处）
        "drizzle.config.ts", // 抽样 1 / 复述 0（1 处）
        "oxlint.parity.config.mjs", // 抽样 1 / 复述 0（1 处：判决配置的职责边界）
        "src/sentry.edge.config.ts", // 抽样 1 / 复述 0（1 处）
        "src/trpc/link.ts", // 抽样 1 / 复述 0（1 处）
        "src/trpc/vanilla.ts", // 抽样 1 / 复述 0（1 处）
        "tools/measure-log-store.ts", // 抽样 1 / 复述 0（1 处）
        "tools/workshop-mcp-http.ts", // 抽样 1 / 复述 0（1 处）
      ],
      rules: {
        "awesomeness/no-novel-comments": "off",
      },
    },
    {
      files: ["src/server/api/routers/**/*.ts"],
      rules: {
        "eslint-js/no-restricted-syntax": [
          "error",
          {
            selector: 'ThrowStatement > NewExpression[callee.name!="TRPCError"]',
            message:
              "router 里请抛 new TRPCError({ code, message })：裸 Error 会被 tRPC 归成 INTERNAL_SERVER_ERROR，客户端就分不出「不存在 / 越权 / 重名」（规范 §11.2.1 第七条、台账 E8）。",
          },
        ],
      },
    },
    /* UI/features 不得直连 Drizzle orm（#2777 从 eslint 迁来；判决配置里同一档在
     * `oxlint.parity.config.mjs` 的 overrides 尾部）。 */
    {
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
    /* #2777 退役前置：2 条从 eslint 接过来的 jsPlugin 规则（与判决配置同一清单，
     * 正反样本对拍见 `tests/oxlint-jsplugin-rules.test.ts`）。
     * `react-hooks/config` 与 `gating` 不迁：无 options 时两引擎均 0 诊断，而启用会让
     * 全仓 lint 从 34s 涨到 64s（+80%），依据同时写在判决配置的 TS 档。
     *
     * 只落在 TS 源码面：`globals` 声明放这一档而不是根级 —— `.cjs` 门禁脚本里自造
     * `window` / `self` 变量，根级全局声明会让 `no-redeclare` 误报一片。 */
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
      globals: {
        document: "readonly",
        globalThis: "readonly",
        location: "readonly",
        self: "readonly",
        window: "readonly",
      },
      rules: {
        "nextjs-js/no-location-assign-relative-destination": "error",
        "react-js/no-deprecated": "error",
      },
    },
  ],
});
