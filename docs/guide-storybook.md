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

## 数据从哪来：`Args → 数据源` 注入层

有一批组件不是「给几个 props 就能看」的：它们吃一张真图、一段真报文，或者吃一条
真 tRPC 链路。给它们写 story 的最小阻力是**手捏一份假数据**，而那比没有 story 更糟
—— 假形态的截图会被当成「这个组件长这样」的证据。

注入层（`.storybook/data-sources.tsx`）把这件事换成流程：**story 声明「我要哪种
数据源」，注入层负责把它变成真的那一份**。两种形态、两套机制：

| 形态 | 是什么 | 怎么用 |
| ---- | ------ | ------ |
| **值源**（`json` / `media`） | 取一份**值**交给组件的 props | story 的 `args.sourceName` + `resolveSource(kind, name)` |
| **运行期提供者**（`trpc` / 应用外壳） | 一条**真链路** / 一层**真上下文**，组件自己 import 单例去读 | `.storybook/preview.tsx` 全局挂的 `withTrpcApp` / `withAppProviders` |

```tsx
import { resolveSource, sourceNameArgType, type JsonSourceName }
  from "../../../.storybook/data-sources";

type StoryArgs = Omit<React.ComponentProps<typeof JsonViewer>, "data"> & {
  sourceName: JsonSourceName;
};

/** 适配件：把 Args 里那个源名解析成真值再交给真组件。 */
function JsonViewerWithSource({ sourceName, ...rest }: StoryArgs) {
  return <JsonViewer {...rest} data={resolveSource("json", sourceName)} />;
}

const meta = {
  title: "UI/JsonViewer",
  component: JsonViewerWithSource,
  args: { sourceName: "comfy-prompt" },
  argTypes: { sourceName: sourceNameArgType("json") },
} satisfies Meta<StoryArgs>;
```

**三条口径**：

1. **数据源是「命名的一种」**，映射只有 `DATA_SOURCES` 一份 —— story 不各写各的
   示例数据。名字做成**组件自己的 args**（Args 面板只认 args，不认 `parameters`
   里的嵌套键）。
2. **拿不到时画的就是「拿不到」**。`media` 源里留了一个**故意不存在**的
   `missing.png`；名字不认识时 `resolveSource()` **抛错**（静默回退会让「源名写错
   了」看不出来）。宁可让你看见「取不到」，也不要一张看着正常、真机上不对的画布。
3. **ReactNode 参数走 `render`，不进 Args**。`trigger` / `footer` / `children`
   这类参数由 story 的 `render` 给 —— Args 面板只认可序列化的值。
   注意 `render` **不是 React 组件**：要在里面用 hook，请把它抽成一个真组件
   （`react-hooks/rules-of-hooks` 会把这一条当场拦下，那条报错是对的）。

**为什么不用 `vi.mock` / MSW**：测试侧确实有 MSW（`tests/helpers/trpc-msw.ts`），
但那层的用途是「让 tRPC 的完整管线在无后端时可被断言」——它转发给一个**测试
router**（预设数据）。那是测试的正当形态：断言的对象是管线，不是界面形态。
story 要的正好相反 ——「有后端 / 没后端分别长什么样」。所以注入层**不拦网络、
不预置返回值**：连得上画真数据，连不上画真的连不上。

### 真 tRPC 链路：能到哪一步，以及那道跨源门槛

组件 import 的 `~/trpc/react` / `~/trpc/vanilla` 都按 `getBaseUrl()` 取 origin
（浏览器里是 `window.location.origin`），而工作台跑在自己的端口上。注入层把它们
指到**真跑着的应用**：origin 是启动时由 `scripts/app-port.mjs` 现算的**本检出解析链
端口**（`pnpm storybook` 会把它写进 `.storybook/generated/app-origin.ts`，不入库），
也可以在工具栏的「应用 origin」旋钮上现场改。

**跨源是一道真门槛**：应用的 tRPC 端点不回 `Access-Control-Allow-Origin`
（它对自己的前端同源，本来就不需要），所以从工作台直接打过去会被浏览器拦下。
**这是刻意不绕的** —— 让应用为组件工作台开一个 CORS 口子，等于为一个开发工具去改
生产端的安全面。于是 tRPC 那一族 story 在画布上通常给你看的是：

- **应用没起** → 各 controller 的拉取失败静默忽略，界面留住它真实的**降级形态**
  （空态 / 离线点）。这是**默认**会看到的，也是真机上最难复现的那一档；
- **跨源被拦** → 组件走它的**错误分支**，画布上就是错误态那张脸。

换句话说：**那一族 story 验的是「界面在后端不可用时的形态」**。想看有数据时的样子，
需要应用在跑**并且同源**（部署问题，不是 story 的问题）。

## 它不做什么

- **不是像素基线**。组件覆盖率再高也不等于「页面没变样」—— 视觉回归的防线仍是
  `e2e/visual` 的 Playwright `toHaveScreenshot`（规范 11 §11.8），那个判的是
  真实页面的布局/配色/断点。两者互补，都不接 Chromatic。
- **不进构建产物**。`.storybook/**` 与 `*.stories.tsx` 不在 Next 的模块图上：
  story 只被 Storybook 自己的 webpack 图引用，`pnpm build` 看不到它们。
  `storybook-static/`、`.storybook/assets/`、`.storybook/generated/` 都在
  `.gitignore` 里。
- **不覆盖业务组件**。`studio/` / `workshop/` 有 story 的那几件验的是**降级形态**
  与**纯形态**；把它们整体覆盖一遍要先把工作台与应用的**同源**问题解决掉
  （见上一节）。（`docs/guides/PRODUCTION-GAPS.md` 的 F6 挂着这条账的全貌。）

## 覆盖率：现在是机器判据，不是文档里的一句话

「有多少组件被看过」此前写在**这一节**里（「当前只有 3 个 `ui/` 示例」）——
文档里的数字会过期，而过期时没有任何东西会红。现在它由
`scripts/storybook-checks/coverage-ledger.mjs` **现算**，与
`scripts/.storybook-coverage-baseline.json` 比：

```bash
node scripts/storybook-check.mjs   # 枚举来源 + 组件覆盖率，一条命令出结论
```

三段判据（`tests/storybook-component-coverage.test.ts` 与门禁脚本共用同一份纯函数）：

1. **只许升不许降**。删 / 改名组件后 story 的 `import` 没跟着改、或直接把
   `.stories.tsx` 删掉，覆盖率掉下来就红。基线数字由**用例**钉住（核基线 == 实测），
   所以手改基线也过不去。
2. **`ui/` 的可预览文件数变了要同批回答问题**：新增组件时得说清「它为什么没有
   story」—— 有界面形态就补一份，没有就写进 `coverage-ledger.mjs` 的
   `NO_STORY_REASON`（**逐条给理由**，不是赦免名单）。
3. **理由表与磁盘对得上**：指向不存在文件的条目是过期账；已经有 story 却还留着的
   条目会静默放行「下一个人把它改回去」。两条都拦。

**分母是什么**：`ui/` 下「有可预览界面形态」的文件 —— `.test.ts(x)`、被测的
hook（`use-*.ts`）不算（它们没有可看的东西，判据是单测）。已覆盖 = 被某个
`.stories.tsx` 直接 `import` 到的那些。

**没有故事的代价**：`docs/guides/PRODUCTION-GAPS.md` 的 F6 里「组件覆盖率」那格
说的就是它 —— story 是「改完 `ui/` 组件想单独看一眼」的出口，没有 story 的组件
只能靠「起整个应用点进去找」或者读那串几百字符的 Tailwind class 来判断改得对不对。

**「有数据依赖」不再是一张免票**：注入层（上一节）之后，吃一张图 / 一段报文 /
一条真链路的组件都有得写。剩下的 `NO_STORY_REASON` 条目因此都收敛到三类 ——
hook（没有 DOM 形态，判据是用例）、只有出错时才渲染的边界件、被别的基元 import
的部件（它的形态在调用它的那个基元的 story 里）。**加一行之前先回答
「没有 story 的代价是什么」**。

## 相关

- 覆盖率的判据与台账：`tests/storybook-component-coverage.test.ts` +
  `scripts/storybook-checks/coverage-ledger.mjs`（那份额外的理由表就在台账里）。
- 注入层的契约判据：`tests/storybook-data-sources.test.ts`（进
  `FIXED_STRUCTURAL_TESTS`）—— 守注册表接线、媒体名与磁盘双向对齐、「点目录进了
  tsc / eslint 的扫描面」这几件**悄悄失效时不会红**的事。它守的是「接线还在不在」；
  「有没有真的画出来」由真浏览器逐 story 渲染核对。
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
