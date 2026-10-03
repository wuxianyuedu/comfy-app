import type { Decorator, Preview } from "@storybook/nextjs";
import { withThemeByClassName } from "@storybook/addon-themes";

import {
  APP_ORIGIN_CHOICES,
  DEFAULT_APP_ORIGIN,
  withAppProviders,
  withTrpcApp,
} from "./data-sources";

// 引入应用的全局样式：主题 token（`@theme` / `.dark` 覆盖）与 Tailwind 都在这里，
// 不引入的话所有组件都会退化成无样式的裸 DOM。
import "../src/app/globals.css";

/**
 * 主题装饰器：与 `src/app/ThemeProvider.tsx` 同一口径。
 *
 * `withThemeByClassName` 给 `<html>` 加/去 `dark` class，正是 globals.css 里
 * `@custom-variant dark (&:where(.dark, .dark *))` 依赖的那条链路；默认 dark
 * 与应用一致（用户未表达偏好时的初始外观）。
 *
 * 不用 next-themes 的 Provider 包一层：它的作用是把偏好持久化到 localStorage
 * 并在首帧前写 class，而 Storybook 的工具栏切换已经覆盖了「看两态」这个诉求，
 * 再叠一个会多出一条不同的 class 写入路径。
 */
const withTheme: Decorator = withThemeByClassName({
  themes: { dark: "dark", light: "" },
  defaultTheme: "dark",
});

/**
 * 工具栏旋钮：真 tRPC 链路指向的应用 origin（见 `data-sources.tsx` 的
 * `DEFAULT_APP_ORIGIN` 那段注释 —— 为什么它不是一个环境变量）。
 *
 * 缺省是**本检出算出来的**那个（启动时由 `scripts/app-port.mjs` 现算，见
 * `data-sources.tsx` 的 `DEFAULT_APP_ORIGIN`）；想指到别的实例时在这里换。
 */
const APP_ORIGIN = "appOrigin";

const preview: Preview = {
  globalTypes: {
    [APP_ORIGIN]: {
      description: "真 tRPC 链路指向的应用 origin（应用没起也能看降级形态）",
      toolbar: {
        icon: "link",
        title: "应用 origin",
        items: Object.entries(APP_ORIGIN_CHOICES).map(([title, value]) => ({
          title: `${title}（${value}）`,
          value,
        })),
        dynamicTitle: true,
      },
    },
  },
  initialGlobals: {
    [APP_ORIGIN]: DEFAULT_APP_ORIGIN,
  },
  /* 顺序即语义：trpc 提供者在最外层（组件一挂载就要能发请求），应用外壳
     （toast / 消息中心 / tooltip）在它里层，主题在最内层（只改 `<html>` 的
     class，与组件树无关）。 */
  decorators: [withTrpcApp, withAppProviders, withTheme],
  parameters: {
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
    a11y: {
      // a11y 违规在测试运行器里报错；在画布上只提示，不打断浏览
      test: "todo",
    },
  },
};

export default preview;
