import type { StorybookConfig } from "@storybook/nextjs";

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
const config: StorybookConfig = {
  stories: ["../src/**/*.mdx", "../src/**/*.stories.@(ts|tsx)"],
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
  // 静态产物落仓库根的 storybook-static/（已 gitignore），不进 next build 的图
  staticDirs: ["../public"],
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
