import awesomeness from "oxlint-config-awesomeness";
import { defineConfig } from "oxlint";

/** 视图层做**精确订阅**的 store hook 名单（单一出处，与 eslint.config.js 同口径）。
 *  见 eslint.config.js 顶部注释：新增 store 时同步加一行，
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
 *  元素表与 `eslint.config.js` 逐字对应（更具体的 server 子目录必须排在
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
  extends: [awesomeness],
  // `eslint` 是 oxlint 原生保留名，oxlint-plugin-eslint 必须显式别名成 eslint-js。
  // eslint-plugin-boundaries 经 jsPlugins 跑（用 resolver 解析别名导入）。
  jsPlugins: [
    { name: "boundaries", specifier: "eslint-plugin-boundaries" },
    { name: "eslint-js", specifier: "oxlint-plugin-eslint" },
  ],
  settings: {
    // eslint-plugin-boundaries 的元素表（根级 settings）。
    "boundaries/elements": boundariesElements,
    // resolver：解析 `~/` / `@/` 别名 → 真实路径，供 boundaries 按 pattern 分类。
    "import/resolver": {
      "eslint-import-resolver-oxc": {},
    },
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
  ],
});
