import type { StorybookConfig } from "@storybook/nextjs-vite";
import fs from "node:fs";
import path from "node:path";

/* 相对 import 一律**带文件后缀**（`.ts` / `.tsx`），不写 `./x`。
 *
 * 原因在加载链路上：Storybook 用一个 Node ESM loader 加载本文件，而 ESM 的解析
 * 规则要求完整说明符 —— loader 会替我们把 `./x` 补成 `./x.ts`，但每补一次就
 * 打一条 deprecation（"One or more extensionless imports detected"，
 * https://storybook.js.org/docs/faq#extensionless-imports-in-storybookmaints-and-required-ts-extensions ）。
 * 那是**每加载一个文件一次**的噪音：真正的报错会被它盖住，而它自己会在下一个
 * Storybook 大版本里变成硬错误。写全后缀在两侧都合法（Node loader 原样放行，
 * vite 两种写法都解析得到），所以这里只有一种写法。
 *
 * 判据：`tests/storybook-config.test.ts` 的「相对 import 带后缀」那条，用 Storybook
 * 自己的 loader 函数点一遍名（它要改写就会红），不是另抄一份正则。 */
import { APP_ORIGIN_DEFAULTS } from "./app-origin-defaults.ts";
import { APP_ORIGIN_ENV_KEYS, parseOverride } from "./app-origin-reader.ts";

/**
 * Storybook 主配置。
 *
 * 用 `@storybook/nextjs-vite` 而不是 `@storybook/react-vite`：本仓库的组件依赖
 * Next 的运行期（`next/link`、`next/navigation`）与 `~` 别名，
 * 该框架自带 next/* 的 mock 与 tsconfig 路径别名解析
 * （`vite-plugin-storybook-nextjs` 经 `vite-tsconfig-paths` 读 `tsconfig.json` 的
 * `paths`）。
 *
 * **为什么是 vite 版而不是 `@storybook/nextjs`**（ISSUE #3372）：后者是 webpack 版，
 * 官方在 Storybook 11 已标记废弃、12 移除。它还把整条 webpack 链拖进依赖图
 * （`@storybook/builder-webpack5` → `node-polyfill-webpack-plugin` →
 * `crypto-browserify` → `elliptic`），迁走后这些都不再进锁文件。
 *
 * `stories` 只扫 `src/`：Storybook 描述的是应用内组件，不覆盖 `.storybook/`
 * 自身的辅助件（providers 装饰器不是 Story）。
 */
/**
 * 本检出的解析链端口（`pnpm storybook` 启动时由 `scripts/storybook-assets.mjs`
 * 现算，落一份不入库的 JSON）。
 *
 * **读文件这一步必须在 `main.ts`**：它由 Storybook 在 **Node** 里加载，而
 * `preview.tsx` 会被打进浏览器 bundle —— 浏览器侧没有 `node:fs`，`readFileSync`
 * 必然抛、于是永远走兜底，而且看不出来。值经**编译期内联**交过去（编出来的
 * bundle 里是字面量而不是 `process.env` 查找）—— 具体走哪条通道见下面
 * `env` 与 `viteFinal` 那两段。
 *
 * 读不到（没跑过工作台的新检出）就用入库的缺省值 —— 那是常态，不是错误。
 * 这也正是本文件与 `preview.tsx` 都不 import 那份生成件的原因（ISSUE #1409）。
 */
/** `JSON.parse` 的产物收窄成「非数组的普通对象」—— 文件内容是不可信输入。 */
function isPlainRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function readAppOriginEnv(): Record<string, string> {
  /* ESM 里没有 `__dirname`（Storybook 用 import 加载本文件），按 `import.meta.url`
     定位 —— 生成件与本文件同在 `.storybook/` 下。 */
  const here = import.meta.dirname;
  const file = path.join(here, "generated", "app-origin.json");
  let parsed = null;
  try {
    const raw: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!isPlainRecord(raw)) {
      throw new Error("app-origin.json 不是对象");
    }
    parsed = parseOverride({
      APP_DEV_PORT: raw[APP_ORIGIN_ENV_KEYS.APP_DEV_PORT] ?? raw.APP_DEV_PORT,
      APP_DEV_ORIGIN: raw[APP_ORIGIN_ENV_KEYS.APP_DEV_ORIGIN] ?? raw.APP_DEV_ORIGIN,
      APP_DEV_PORT_SOURCE: raw[APP_ORIGIN_ENV_KEYS.APP_DEV_PORT_SOURCE] ?? raw.APP_DEV_PORT_SOURCE,
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

/** 本检出的三个值（读一次，两处用）。见下面 `env` 与 `viteFinal` 那两段说明。 */
const appOriginEnv = readAppOriginEnv();

const config: StorybookConfig = {
  stories: ["../src/**/*.mdx", "../src/**/*.stories.@(ts|tsx)"],
  /* `env` 是 Storybook 的编译期常量注入口：这里的值会被内联进浏览器 bundle。
   *
   * ⚠️ **在 vite builder 下它落到 `import.meta.env`，落不到 `process.env`**
   * （ISSUE #3372 的实测：`@storybook/builder-vite` 的 `stringifyProcessEnvs` 只把
   * **匹配 `envPrefix`**（`VITE_` / `STORYBOOK_`）的键 define 成
   * `import.meta.env.<KEY>`，而本仓的三个键是 `SB_APP_DEV_*`、一个都不匹配）。
   * 所以这一项**不是**取值面的承重通道 —— 承重的是下面 `viteFinal` 的 `define`。
   * 它留着是因为它是 builder 无关的那条路：将来 builder 改了映射口径，这里
   * 不用动。 */
  env: (existing) => ({ ...existing, ...appOriginEnv }),
  /* **承重的那一条**：把同一份值显式 define 成 `process.env` 的整体对象。
   *
   * 为什么必须显式做（实测读数，ISSUE #3372）：vite 把浏览器侧的 `process.env`
   * 默认 define 成 `{}`（`vite:define` 插件的 `processEnv` 常量），于是
   * `app-origin-reader.ts` 里那三处 `process.env[SB_APP_DEV_*]` 全部取到
   * `undefined` —— **编译不报错、构建退 0、story 数一条不少**，只是注入层永远
   * 退回缺省端口（3100），工具栏旋钮与真 tRPC 链路的 origin 全是错的。
   * 这种「静默退化成缺省值」正是本仓判据最该盯的形状。
   *
   * 为什么 define **整个 `process.env`** 而不是三个 `process.env.<KEY>`：
   * 读取面是**计算属性访问**（`process.env[KEY]`），而 define 认的是字面量成员
   * 表达式 —— 只 define 三个具体键的话，`process.env[KEY]` 仍会先被
   * `process.env` → `{}` 命中、结果还是 `undefined`。define 整个对象之后，
   * 读取侧那三行**一个字都不用改**（键名仍由 `app-origin-reader.ts` 的
   * `APP_ORIGIN_ENV_KEYS` 一处定义，两侧共用）。
   *
   * 注：vite 的默认 define 里另有 `process.env.NODE_ENV`（更长的键优先命中），
   * 所以 React 的运行期判定不受影响。 */
  viteFinal: (viteConfig) => {
    viteConfig.define = {
      ...viteConfig.define,
      "process.env": JSON.stringify(appOriginEnv),
    };
    return viteConfig;
  },
  addons: [
    // 交互测试与 a11y 面板（a11y 的**自动化执行者**在 `tests/a11y-axe-stories.test.ts`，台账 E6；
    // 这个面板是人现场看某一棵树用的，两者不是同一件事）
    "@storybook/addon-a11y",
    // 深浅色主题切换：与 next-themes 的 class 策略对齐（见 preview.tsx）
    "@storybook/addon-themes",
    // 自动生成组件文档页（ArgsTable / 源码面板）
    "@storybook/addon-docs",
  ],
  framework: {
    name: "@storybook/nextjs-vite",
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
  staticDirs: ["../public", { from: "../.storybook/assets", to: "/storybook-assets" }],
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
