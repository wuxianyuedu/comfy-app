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
