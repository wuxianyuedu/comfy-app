import type { StorybookConfig } from "@storybook/nextjs";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/* 相对 import 一律**带文件后缀**（`.ts` / `.tsx`），不写 `./x`。
 *
 * 原因在加载链路上：Storybook 用一个 Node ESM loader 加载本文件，而 ESM 的解析
 * 规则要求完整说明符 —— loader 会替我们把 `./x` 补成 `./x.ts`，但每补一次就
 * 打一条 deprecation（"One or more extensionless imports detected"，
 * https://storybook.js.org/docs/faq#extensionless-imports-in-storybookmaints-and-required-ts-extensions ）。
 * 那是**每加载一个文件一次**的噪音：真正的报错会被它盖住，而它自己会在下一个
 * Storybook 大版本里变成硬错误。写全后缀在两侧都合法（Node loader 原样放行，
 * webpack 两种写法都解析得到），所以这里只有一种写法。
 *
 * 判据：`tests/storybook-config.test.ts` 的「相对 import 带后缀」那条，用 Storybook
 * 自己的 loader 函数点一遍名（它要改写就会红），不是另抄一份正则。 */
import { APP_ORIGIN_DEFAULTS } from "./app-origin-defaults.ts";
import { APP_ORIGIN_ENV_KEYS, parseOverride } from "./app-origin-reader.ts";

/**
 * Storybook 主配置。
 *
 * 用 `@storybook/nextjs` 而不是 `@storybook/react-vite`：本仓库的组件依赖
 * Next 的运行期（`next/link`、`next/font`、`next/navigation`）与 `~` 别名，
 * 该框架自带 Next 的 webpack 别名与 `next.config.js` 解析。
 *
 * `stories` 只扫 `src/`：Storybook 描述的是应用内组件，不覆盖 `.storybook/`
 * 自身的辅助件（providers 装饰器不是 Story）。
 */
/**
 * 本检出的解析链端口（`pnpm storybook` 启动时由 `scripts/storybook-assets.mjs`
 * 现算，落一份不入库的 JSON）。
 *
 * **读文件这一步必须在 `main.ts`**：它由 Storybook 在 **Node** 里加载，而
 * `preview.tsx` 会被打进浏览器 bundle —— webpack 在那里把 `node:fs` 换成 stub
 * （实测编出来的调用是 `node_fs_ignored_default()`），`readFileSync` 必然抛、
 * 于是永远走兜底，而且看不出来。值经 `env` 交过去（Storybook 在**编译期内联**
 * 进 bundle，实测是字面量而不是 `process.env` 查找）。
 *
 * 读不到（没跑过工作台的新检出）就用入库的缺省值 —— 那是常态，不是错误。
 * 这也正是本文件与 `preview.tsx` 都不 import 那份生成件的原因（ISSUE #1409）。
 */
function readAppOriginEnv(): Record<string, string> {
  /* ESM 里没有 `__dirname`（Storybook 用 import 加载本文件），按 `import.meta.url`
     定位 —— 生成件与本文件同在 `.storybook/` 下。 */
  const here = path.dirname(fileURLToPath(import.meta.url));
  const file = path.join(here, "generated", "app-origin.json");
  let parsed = null;
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8")) as Record<
      string,
      unknown
    >;
    parsed = parseOverride({
      APP_DEV_PORT: raw[APP_ORIGIN_ENV_KEYS.APP_DEV_PORT] ?? raw.APP_DEV_PORT,
      APP_DEV_ORIGIN:
        raw[APP_ORIGIN_ENV_KEYS.APP_DEV_ORIGIN] ?? raw.APP_DEV_ORIGIN,
      APP_DEV_PORT_SOURCE:
        raw[APP_ORIGIN_ENV_KEYS.APP_DEV_PORT_SOURCE] ?? raw.APP_DEV_PORT_SOURCE,
    });
  } catch {
    /* 文件不在 / 读不动：两种情况都退回缺省。 */
  }
  const value = parsed ?? APP_ORIGIN_DEFAULTS;
  return {
    [APP_ORIGIN_ENV_KEYS.APP_DEV_PORT]: String(value.APP_DEV_PORT),
    [APP_ORIGIN_ENV_KEYS.APP_DEV_ORIGIN]: value.APP_DEV_ORIGIN,
    [APP_ORIGIN_ENV_KEYS.APP_DEV_PORT_SOURCE]: value.APP_DEV_PORT_SOURCE,
  };
}

const config: StorybookConfig = {
  stories: ["../src/**/*.mdx", "../src/**/*.stories.@(ts|tsx)"],
  /* `env` 是 Storybook 的编译期常量注入口：这里的值会被内联进浏览器 bundle，
     所以 `preview.tsx` 读 `process.env[SB_APP_DEV_*]` 拿得到（见上面那段说明）。 */
  env: (existing) => ({ ...existing, ...readAppOriginEnv() }),
  addons: [
    // 交互测试与 a11y 自动化（补 PRODUCTION-GAPS F6 的 a11y 缺口）
    "@storybook/addon-a11y",
    // 深浅色主题切换：与 next-themes 的 class 策略对齐（见 preview.tsx）
    "@storybook/addon-themes",
    // 自动生成组件文档页（ArgsTable / 源码面板）
    "@storybook/addon-docs",
  ],
  framework: {
    name: "@storybook/nextjs",
    options: {},
  },
  /* 静态目录：`public/` 之外再加一份**开发期资源**目录。
   *
   * `.storybook/assets/` 是注入层（`data-sources.tsx` 的 `media` 值源）用的真图片，
   * 由 `scripts/build-storybook-assets.mjs` 现生成、**不入库**（同样 gitignore）。
   * 为什么不放 `public/`：那里会随 `next build` 进 standalone 产物、再被
   * `build-desktop` 内嵌进桌包（`scripts/check-standalone-contents.cjs` 的顶层
   * 白名单把它列得一清二楚）；组件工作台的示例资源没有任何理由跟着出厂。
   * 两份都列进 `staticDirs` 时后者挂同一个站点根，路径不冲突（文件在
   * `/storybook-assets/` 前缀下）。
   *
   * 静态产物落仓库根的 storybook-static/（已 gitignore），不进 next build 的图。 */
  staticDirs: [
    "../public",
    { from: "../.storybook/assets", to: "/storybook-assets" },
  ],
  typescript: {
    // 类型正确性由仓库的 `tsc --noEmit` 统一保证，故事文件也在 tsconfig 的
    // include 里 —— 这里不重复做一次 react-docgen 的宽松检查。
    reactDocgen: false,
  },
  core: {
    // 关掉遥测：本仓库有明确的数据外发红线（见 next.config.js 的 Sentry 注释）
    disableTelemetry: true,
  },
};

export default config;
