import tseslint from "typescript-eslint";
import next from "eslint-config-next/core-web-vitals";
import unusedImports from "eslint-plugin-unused-imports";

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
  {
    linterOptions: {
      reportUnusedDisableDirectives: true,
    },
  },
);
