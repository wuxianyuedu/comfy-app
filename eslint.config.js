import tseslint from "typescript-eslint";
import next from "eslint-config-next/core-web-vitals";
import unusedImports from "eslint-plugin-unused-imports";
import boundaries from "eslint-plugin-boundaries";

export default tseslint.config(
  {
    ignores: [
      ".next",
      // 构建产物与生成代码：无需 lint
      "generated/**",
      "src-tauri/static/**",
      "temp/**",
      "python-venv/**",
      // PyInstaller onedir 产物（start-tauri/、start-tauri-standalone/ 等）：
      // 目录被清理后 eslint 9 默认会 walk 全部目录，humanfs 遇到不存在目录会 ENOENT 崩溃，显式忽略避免
      "start-tauri*/",
      "build-launcher*/",
    ],
  },
  // eslint-config-next@16 已改为扁平（flat）配置，直接导出配置数组。
  // 旧写法用 FlatCompat.extends() 去加载它会触发 config-validator 对含
  // 插件/函数的扁平对象做 JSON 序列化，从而 TypeError: Converting circular
  // structure to JSON。这里直接展开扁平数组，绕开该崩溃。
  ...next,
  {
    files: ["**/*.ts", "**/*.tsx"],
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
  // 说明:src/lib/comfyui、src/lib/film、src/lib/llm 含 client-safe 的 types/helpers,
  //       不整体划入 server,避免误伤组件对它们的合法 import。
  // Drizzle schema 位于 src/server/db/schema(已属 server),故 UI import schema/仓储即被
  //       components→server 拦截;UI 直引 drizzle-orm orm 包在本 pnpm 解析下 module.source
  //       为 null,无法用 module 选择器匹配,故交由 repositories 间接管控。
  {
    plugins: { boundaries },
    settings: {
      "boundaries/elements": [
        { type: "server", pattern: "src/server/**" },
        { type: "server", pattern: "src/lib/core/**" },
        { type: "server", pattern: "src/lib/db/**" },
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
          ],
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
