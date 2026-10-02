# 组件工作台 Storybook 使用指南

> 一句话：`pnpm storybook` 起一个组件工作台，逐个组件在**受控 props** 下看形态、
> 切明暗两态、跑 a11y 报告；`pnpm storybook:build` 出静态产物（不入库）。
> 它**不替代** `e2e/visual` 的 Playwright 像素基线 —— 两者判的不是同一件事。

## 它解决什么

改 `src/components/ui/**` 的痛点一直是「**看不到**」：一个 `buttonVariants` 多一档
变体、`Badge` 多一个 `tone`，要判断它对不对，此前只有两条路 —— 起整个应用点进去找
那个刚好用到它的界面，或者去读那串 500 字符的 Tailwind class。两条路的反馈都太慢，
后果是「样式改动没人验」：`docs/guides/PRODUCTION-GAPS.md` 的 **F6** 就是这么挂着的。

Storybook 把这一步缩成「起一个工作台、点开那个组件」：

- **左栏**按 `UI/*` 分组列出所有 story；
- **画布**是组件本身，带 Args 面板可以现场改 props；
- **工具栏**切 `dark` / `light`（与应用的 `next-themes` 同一条 class 链路）；
- **a11y 面板**列出这棵树的违规项（补 F6 的 a11y 自动化缺口）。

## 怎么用

```bash
pnpm storybook         # 起工作台（http://127.0.0.1:6006）
pnpm storybook:build   # 出静态产物到 storybook-static/（已 gitignore）
```

两条命令都不需要 `.env`：启动器注入了 `SKIP_ENV_VALIDATION=1`。

## 怎么加一个 story

跟组件**同目录**、文件名 `<component>.stories.tsx`（`stories` glob 见
`.storybook/main.ts`）。CSF3 形态、`satisfies Meta<typeof Component>`：

```tsx
import type { Meta, StoryObj } from "@storybook/nextjs";
import { Badge } from "~/components/ui/badge";

const meta = {
  title: "UI/Badge",
  component: Badge,
  args: { children: "徽标" },
} satisfies Meta<typeof Badge>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
```

**枚举不要从 cva 的返回值上取**。`cva()` 返回的是一个 `(props?) => string` 的
**函数**，运行时并没有 `.variants`（它只存在于 TS 泛型里）：

```tsx
// ❌ tsc 会红；Storybook 则在**加载期**抛 Cannot read properties of undefined
//    —— 表现是「侧栏列着故事、画布上一片空白」
const variants = Object.keys(buttonVariants.variants.variant);

// ✅ 从 props 派生，新增一档变体时这里跟着类型报错
type ButtonVariant = NonNullable<
  React.ComponentProps<typeof Button>["variant"]
>;
const VARIANTS: ButtonVariant[] = ["default", "outline" /* … */];
```

`ui/button.stories.tsx` / `ui/badge.stories.tsx` 就是这么写的，照抄它们。

**手写清单必须覆盖每一档，别只列「常用的那几档」**：这条有机器判据兜着
（`tests/storybook-cva-variant-source.test.ts` + `node scripts/storybook-check.mjs`），
`cva` 里加一档而故事没跟上、或整条轴被漏掉，提交时就会被点出来。判据上线时当场
抓到一处真漏档：`button.stories.tsx` 的 `SIZES` 少列了 `icon-sm` / `icon-lg`，
而这两档全库有 **46 处**在用 —— 「枚举手写一份」的代价是必然的，判据的作用是把
它从「静默漏掉」变成「提交时报出来」。

**为什么不用 `Object.keys(xxxVariants.variants.轴)` 一步到位**：见上一条 ——
`cva()` 返回的是函数，运行期没有 `.variants`。顺着「宏定义一个数组再 spread 到
各项」的思路去找捷径，最后都会绕回这个坑上。

## 明暗两态

`.storybook/preview.tsx` 用 `addon-themes` 的 `withThemeByClassName`，给 `<html>`
加/去 `dark` class —— 正是 `src/app/globals.css` 的
`@custom-variant dark (&:where(.dark, .dark *))` 依赖的那条链路，默认 `dark`
（与 `src/app/ThemeProvider.tsx` 的初始外观一致）。

**刻意不叠一层 `next-themes`**：它的职责是把偏好持久化到 localStorage 并在首帧前
写 class，而工具栏切换已经覆盖「看两态」这个诉求；再叠一个会多出一条**不同的**
class 写入路径，日后「应用里是暗的、storybook 里是亮的」这类不一致就很难归因。

## 它不做什么

- **不是像素基线**。组件覆盖率再高也不等于「页面没变样」—— 视觉回归的防线仍是
  `e2e/visual` 的 Playwright `toHaveScreenshot`（规范 11 §11.8），那个判的是
  真实页面的布局/配色/断点。两者互补，都不接 Chromatic。
- **不进构建产物**。`.storybook/**` 与 `*.stories.tsx` 不在 Next 的模块图上：
  story 只被 Storybook 自己的 webpack 图引用，`pnpm build` 看不到它们。
  `storybook-static/` 已在 `.gitignore` 与 `tsconfig` 的 exclude 里。
- **不覆盖业务组件**。当前只有 3 个 `ui/` 示例（14 个 story）当样板；`studio/`、
  `workshop/` 那些依赖 tRPC / 画布运行期的组件要做 story，得先看它们的
  数据依赖能不能用 Args 注入。（`docs/guides/PRODUCTION-GAPS.md` 的 F6 挂着
  这条账的全貌。）

## 相关

- 枚举来源的判据：`tests/storybook-cva-variant-source.test.ts` 与
  `scripts/storybook-check.mjs`（共用 `scripts/storybook-checks/cva-variant-source.mjs`
  的纯函数，AST 判；详细口径见规范 [16 §16.2.3.4](standards/16-shadcn-ui与表单校验.md#16234-故事里的枚举清单从-props-派生不要从-cva-的返回值上取)）。
  它与下面那条配置契约**守的不是同一件事**：这条管「故事文件自己怎么写」。
- 配置契约的判据：`tests/storybook-config.test.ts`（进 `FIXED_STRUCTURAL_TESTS`）
  —— 它守的是那四种「**构建全都成功**」的错法：`stories` glob 写错（侧栏空着）、
  漏引 `globals.css`（无样式裸 DOM）、漏主题装饰器（只剩 dark 一态）、启动器漏
  `SKIP_ENV_VALIDATION`（崩在 `env.js` 却看不出与配置有关）。
- 为什么启动要经 `scripts/storybook.mjs`：`@storybook/nextjs` 会加载仓库根的
  `next.config.js`，而它第一行就是 `import "./src/env.js"`。组件预览不需要
  `BETTER_AUTH_SECRET` / `DATABASE_URL`，所以注入 `SKIP_ENV_VALIDATION=1` 绕开
  —— 口径与 `playwright.config.ts` 的 webServer、CI 的 `pnpm build` 一致。
  **不改 `next.config.js`**：那份导入是应用启动期的真实约束，不是它写错了。
- 跨平台形态登记在 [launch-and-build.md §9.5](standards/launch-and-build.md#95-跨平台动作对照表ps1-与-mjs-不许分叉机器强制)。
