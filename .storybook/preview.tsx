import type { Decorator, Preview } from "@storybook/nextjs-vite";
import { withThemeByClassName } from "@storybook/addon-themes";

/* 相对 import 一律**带文件后缀**，不写 `./x` —— 理由见 `main.ts` 那段说明。
   本文件由 vite 打进浏览器 bundle（不吃 Node 那条 loader 的 deprecation），
   但仍按同一条口径写：`.storybook/**` 只有一种写法，判据也只有一条。 */
import { appOriginChoices, withAppProviders, withTrpcApp } from "./data-sources.tsx";
import { withMessageScene } from "./message-center-sources.tsx";
import { withStoreScene } from "./store-sources.tsx";
import { withWorkflowRunScene } from "./workflow-run-sources.tsx";
import { readAppOrigin } from "./app-origin-reader.ts";

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
 * 缺省是**本检出算出来的**那个：`pnpm storybook` 启动时由权威实现
 * `scripts/app-port.mjs` 现算，落 `.storybook/generated/app-origin.json`，这里在
 * **配置加载期**（Node 里，不是浏览器里）读出来。读不到（没跑过工作台的新检出）
 * 就用 `app-origin-defaults.ts` 里那份入库的缺省值 —— 那份文件也正是类型与
 * 字段名的出处，所以本模块与 tsc 都不依赖那份生成件（ISSUE #1409）。
 */
const APP_ORIGIN = "appOrigin";
const appOrigin = readAppOrigin();

const preview: Preview = {
  globalTypes: {
    [APP_ORIGIN]: {
      description: "真 tRPC 链路指向的应用 origin（应用没起也能看降级形态）",
      toolbar: {
        icon: "link",
        title: "应用 origin",
        items: Object.entries(appOriginChoices(appOrigin)).map(([title, value]) => ({
          title: `${title}（${value}）`,
          value,
        })),
        dynamicTitle: true,
      },
    },
  },
  initialGlobals: {
    [APP_ORIGIN]: appOrigin.APP_DEV_ORIGIN,
  },
  /* 顺序即语义：trpc 提供者在最外层（组件一挂载就要能发请求），应用外壳
     （toast / 消息中心 / tooltip）在它里层，两个 store 场景装饰器在组件挂载
     **之前**写状态（否则首帧读的是空 store），主题在最内层（只改 `<html>` 的
     class，与组件树无关）。

     **三个 store 装饰器都在 `withAppProviders` 里层、且谁先谁后不影响对方**：
     它们读各自的 `parameters` 键（`storeScene` / `messageScene` / `runScene`），
     缺席时什么都不做 —— 没声明的 story 走真实 store，不被搅（见
     `.storybook/store-sources.tsx`、`.storybook/message-center-sources.tsx`
     与 `.storybook/workflow-run-sources.tsx`）。

     ⚠️ 一处容易踩的：`MessageCenterPanel` 的 story 里那个面板**不是** story 自己
     渲染的，而是 `withAppProviders` 的 `StorybookAppProviders` 挂的（与
     `src/app/layout.tsx` 同形）。也就是说 `messageScene` 必须写在**能被装饰器
     读到**的那一层，且 `open` 要在外壳的子树渲染之前置好 —— 否则面板首帧读到
     `open: false` 直接 `return null`，画布上一片空白。 */
  decorators: [
    withTrpcApp,
    withAppProviders,
    withStoreScene,
    withMessageScene,
    withWorkflowRunScene,
    withTheme,
  ],
  parameters: {
    /* 本检出的解析链端口 + 来源：注入层（`data-sources.tsx` 的 `DEFAULT_APP_ORIGIN`）
       读这里，而不是 import 那份生成件 —— 生成件不入库，不该进类型程序。 */
    appOrigin,
    /* **App Router 的导航能力**（ISSUE #3372 随框架迁到 vite 时补上的）。
     *
     * `next/navigation` 只在 app 目录下可用，而框架据此决定把
     * `next/navigation` 换成哪一套桩：不开这个参数时，`usePathname` /
     * `useRouter` / `useSearchParams` 拿不到桩，用到它们的组件在画布上直接抛。
     *
     * 本仓**只有** app 目录（没有 `src/pages/`），所以按官方口径全局开：
     * 「若项目每个页面都在 app 目录，就可以在 `.storybook/preview.tsx` 里设成
     * `true` —— 对全部 story 生效」。
     */
    nextjs: {
      appDirectory: true,
    },
    controls: {
      matchers: {
        color: /(?:background|color)$/i,
        date: /Date$/i,
      },
    },
    a11y: {
      // a11y 违规在测试运行器里报错；在画布上只提示，不打断浏览
      test: "todo",
    },
  },
};

/** 工具栏旋钮的缺省值 = 本检出算出来的那个 origin（注入层也读同一份）。 */

export default preview;
