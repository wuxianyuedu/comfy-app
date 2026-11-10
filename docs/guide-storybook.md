# 组件工作台 Storybook 使用指南

> 一句话：`pnpm storybook` 起一个组件工作台，逐个组件在**受控 props** 下看形态、
> 切明暗两态、跑 a11y 报告；`pnpm storybook:build` 出静态产物（不入库）。
> 它**不替代**页面级视觉回归 —— 两者判的不是同一件事（那一层已整档撤掉，见
> [11 §11.8](standards/11-测试与可观测性.md)）。

## 它解决什么

改 `src/components/ui/**` 的痛点一直是「**看不到**」：一个 `buttonVariants` 多一档
变体、`Badge` 多一个 `tone`，要判断它对不对，此前只有两条路 —— 起整个应用点进去找
那个刚好用到它的界面，或者去读那串 500 字符的 Tailwind class。两条路的反馈都太慢，
后果是「样式改动没人验」：`docs/guides/PRODUCTION-GAPS.md` 的 **F6** 就是这么挂着的。

Storybook 把这一步缩成「起一个工作台、点开那个组件」：

- **左栏**按 `UI/*` 分组列出所有 story；
- **画布**是组件本身，带 Args 面板可以现场改 props；
- **工具栏**切 `dark` / `light`（与应用的 `next-themes` 同一条 class 链路）；
- **a11y 面板**列出这棵树的违规项（**人**现场看某一棵树）。台账 E6 那一格的**自动化执行者**不在这里，
  是 `tests/a11y-axe-stories.test.ts`：按 Storybook 的语义（`story.render ?? meta.render`，
  args 取 `meta.args` 与 `story.args` 的浅合并）把每个故事渲进 jsdom 再跑 axe-core。
  两处的**分工不是「一个自动一个人」**：那一档只判 jsdom 给得出事实的东西（结构、名字、
  角色、状态），而 `color-contrast` / `label-content-name-mismatch` / `link-in-text-block`
  要的是字体度量、伪元素 `content` 与真实布局 —— jsdom 没有，Tailwind class 在测试里也不生效，
  所以那三条在那一档被显式关掉并逐条写明理由。**面板这里判得到的，恰恰是 jsdom 判不了的那一类**。

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
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
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

**故事文件自己也受四条判据守着**（`scripts/storybook-checks/story-surface.mjs`）：
`title` 必须有（缺了 Storybook 按路径自动生成条目，落在侧栏哪个分组取决于推导规则）、
真组件必须接上（`component:` 直连，或经适配件 —— 但适配件里得真的渲染它）、
同目录的分组前缀要一致、**新写 / 改过的**故事必须给必填 props 的 `args`
（不写的话组件在画布上抛 `Cannot read properties of undefined` —— 就是下面
「侧栏列着故事、画布一片空白」那个形态）。最后一条只挡新增，理由见规范
[16 §16.2.3.8](standards/16-shadcn-ui与表单校验.md)。

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

| 形态                                  | 是什么                                                      | 怎么用                                                               |
| ------------------------------------- | ----------------------------------------------------------- | -------------------------------------------------------------------- |
| **值源**（`json` / `media`）          | 取一份**值**交给组件的 props                                | story 的 `args.sourceName` + `resolveSource(kind, name)`             |
| **运行期提供者**（`trpc` / 应用外壳） | 一条**真链路** / 一层**真上下文**，组件自己 import 单例去读 | `.storybook/preview.tsx` 全局挂的 `withTrpcApp` / `withAppProviders` |

```tsx
import {
  resolveSource,
  sourceNameArgType,
  type JsonSourceName,
} from "../../../.storybook/data-sources";

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
   （`react/rules-of-hooks` 会把这一条当场拦下，那条报错是对的）。

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

## 三层注入：store / React Flow / 整屏容器

值源（上一节）解决的是「**props 给什么**」。而 `studio/` / `workshop/` 里还有三族
组件不吃 props —— 它们吃 **store**、**画布上下文**、**整屏组合**。给它们写 story 时
最小阻力同样是造假的（手捏一份 store 状态、挂一个假 provider、塞一个占位子件），
而三种假法的表现都一样：**画布上照样有内容**，只是真机上是另一回事。

所以 `.storybook/` 下另有五份注入层，story 只声明**场景名**：

| 注入层     | 文件                                    | story 怎么用                                                              |
| ---------- | --------------------------------------- | ------------------------------------------------------------------------- |
| store      | `.storybook/store-sources.tsx`          | `parameters.storeScene: "<场景名>"`（装饰器已全局挂）                     |
| React Flow | `.storybook/flow-canvas.tsx`            | 直接摆 `<StorybookFlowCanvas scene={canvasScene("<场景名>")}>`            |
| 整屏容器   | `.storybook/screen-frame.tsx`           | 直接摆 `AppShell` / 工作区框，项目经 `useSeededProjects()` 备             |
| 消息中心   | `.storybook/message-center-sources.tsx` | `parameters.messageScene: "<场景名>"`（装饰器已全局挂）                   |
| 工作流运行 | `.storybook/workflow-run-sources.tsx`   | `parameters.runScene: "<场景名>"`（装饰器已全局挂；执行日志时间线那一族） |

```tsx
/* store：一段真格式的日志原文进 store 自己的解析入口 */
const meta = {
  title: "Studio/Logs/LogPanel",
  component: LogPanel,
  parameters: { storeScene: "mixed" }, // ← 就这一行
} satisfies Meta<typeof LogPanel>;
```

```tsx
/* React Flow：真画布，节点渲染器由 story 通过 nodeTypes 注入。
   渲染器比 560px 的框高时加 `fit` —— 否则钉住的视口会把内容切掉一截
   （见下面「框架装不下」那条）。 */
<StorybookFlowCanvas
  scene={withNodeType(canvasScene("twoNodes"), "story")}
  nodeTypes={{ story: MyNode }}
  fit
/>
```

```tsx
/* 整屏容器：真 AppShell + 真视图；项目在子树渲染之前就建好 */
function ShellHarness() {
  const projects = useSeededProjects({
    primary: projectScene("namedProject"),
    extraNames: ["城市夜景"],
  });
  return (
    <AppShell active="works" projects={projects.map((p) => ({ id: p.id, name: p.name }))} …>
      <WorksGallery />
    </AppShell>
  );
}
```

**三条口径**：

1. **store 里的条目不手写**。场景收的是**真格式的原文**，由 store 自己的
   `parseFileLogs()` 解析、经真 action `appendFileLogs()` 落板 —— 于是计数、来源
   分桶、时间线排序全由生产代码算出来。`useLogStore.setState({ logs: [...] })` 也能
   让画布有内容，但它把「解析 + 派生」两条链路整个跳过，验的成了「store 能不能
   存数组」。
2. **原文按「自己那条通道的格式」分块**。三路日志的正则各不相同（启动链路
   `[HH:MM:SS]`、应用服务与运行期 ISO 时刻带级别段），一段原文**不能**同时冒充三条
   通道 —— 全按一个 origin 入库时「来源」那一列会整列同名，分桶与计数等于没验。
3. **画布与整屏各有各的「真」**。React Flow 层给真 `<ReactFlowProvider>` /
   `<ReactFlow>`（真转换矩阵、真视口、真 `useNodeId()`），不摆自绘的假画布；
   整屏层给真 `AppShell` + **真视图**（`WorksGallery` 那种真读 `canvas-store` 的屏），
   不摆占位 `<div>`。

**每层有哪些场景**（挑一个之前先看有没有现成的，别再手写一份）：

| 层         | 场景（注册表里的名字）                                                                                                 |
| ---------- | ---------------------------------------------------------------------------------------------------------------------- |
| store      | `mixed` / `errorsOnly` / `rowShapes` / `sameMillisecond` / `singleOrigin` / `longTimeline` / `cliExpandable` / `empty` |
| React Flow | `twoNodes` / `zoomedIn` / `zoomedOut` / `fanOut` / `mixedKinds` / `dense`                                              |
| 整屏容器   | `emptyProject` / `namedProject` / `longNameProject` / `filledProject`                                                  |
| 消息中心   | `mixed` / `singleUnread` / `overflowingUnread` / `allRead` / `empty` / `closed`                                        |

几条选择上的经验（铺场景时踩出来的）：

- **一档一个维度**：`sameMillisecond` 摆的是排序次键（同刻行按 `seq` 定先后）、
  `longTimeline` 摆的是分页（一页 2000 条之外还有货）、`dense` 摆的是标尺步长在
  满负载下现算 —— 它们在「最少那几档」里**都看不出来**。
- **量大的场景用生成器，但生成的是原文**：`appLines()` / `sameMsLines()` 交出的
  是文本（`join("\n")`），解析仍归 `parseFileLogs()`。时刻真的递增（长线）或真的
  全等（同毫秒）—— 手写时最容易把「同一毫秒」写成「相邻毫秒」。
- **有内容的项目要走 `placeCanvasNode()`**（`screen-frame.tsx` 的 `canvasNodes()`）：
  手写节点对象只填两个字段，而节点渲染器读的是 `defaultData(kind)` 的整套默认值。
- **框架装不下就传 `fit`**：`StorybookFlowCanvas` 的框高是固定的 560px，而渲染器
  尺寸是你的事。你自己的节点渲染器比框高、又没传 `fit` 时，钉住的视口会把最后一张
  卡的下沿切掉 —— 构建 / tsc / eslint 全绿，只有画布上少一截（实测 `fanOut` 切
  151px、`mixedKinds` 切 51px）。传 `fit` 就交回 React Flow 的 `fitView` 缩到框里；
  **被测对象就是那个缩放的档**（`zoomedIn` / `zoomedOut` / `dense`，注册表里带
  `pinZoom`）反过来**不能**传 `fit` —— 缩走就不是那一档了。判据见
  `tests/storybook-fit-viewport.test.ts`（规范 16 §16.2.3.13）。

```tsx
/* 消息中心：声明「哪一处生产方在生产」，文案由生产方现算 */
const meta = {
  title: "MessageCenter/Panel",
  component: MessageCenterPanel,
  parameters: { messageScene: "mixed" }, // ← 就这一行
} satisfies Meta<...>;
```

**消息中心那一层有一处与前三层不同的接线点**：`MessageCenterPanel` 是**全屏**的
（`fixed` + `top-title-bar`），而外壳（`withAppProviders`）**全局**挂它 —— 于是
「消息中心开着」的场景里，`MessageCenterButton` 自己那几档 story 会被面板整个盖住，
画布上是「面板 + 左上角露出来的半颗铃铛」，**要看的角标与色调根本不在画面上**。
要看按钮那一侧时显式声明 `parameters.messagePanelHidden: true`（外壳不挂面板，
组件照常从 store 读到 `open`）。刻意不是全局默认 —— 面板在真机上就是常驻的。

**一处容易踩的坑**：`ProjectCanvas` / `WorkshopPipeline` 在**挂载那一刻**读
`getActiveId()`，而 React 的 effect 是子先父后 —— 把「建项目」放 `useEffect` 里，
子组件读到的是「还没有活跃项目」，工坊标题会落在「未命名项目」上、画布落在空白
草稿上。`useSeededProjects()` 因此走 `useState` 的**惰性初始化器**。

**另一处容易误读的**：工坊顶栏显示**不是项目名**，而是**草稿**的 `meta.title`
（新草稿默认「未命名项目」）。已命名项目 + 新草稿时画布上仍是「未命名项目」，
那是真实行为。

跨源那道门槛与上一节相同：这三层的 story 会真发请求（`/api/production`、
`/api/workshop/draft`、`project.*`），应用没起时看到的是这些屏真实的**降级形态**。

## 它不做什么

- **不是像素基线**。组件覆盖率再高也不等于「页面没变样」—— 页面级视觉回归这一层
  **已经整档撤掉**（见 11 §11.8）：曾经有过 5 份 `e2e/visual/*.visual.spec.ts`
  - 两档平台基线，理由不成立所以删掉了。⇒ **不要**因为「页面级没人管了」就把截图断言写进
    story —— 那是给同一件事造第二套基线，而两套基线的维护成本正是当初撤掉它的理由之一。
    真要看像素时，人的动作是**把页面跑起来看**，不是加一层基线。
- **不进构建产物**。`.storybook/**` 与 `*.stories.tsx` 不在 Next 的模块图上：
  story 只被 Storybook 自己的 vite 图引用，`pnpm build` 看不到它们。
  `storybook-static/`、`.storybook/assets/`、`.storybook/generated/` 都在
  `.gitignore` 里。
- **不覆盖业务组件的全部形态**。`studio/` / `workshop/` 有 story 的 23 件里，
  纯 props 与结构化入参那一批验的是**真实形态**（数值调组件自己的派生函数现算）；
  吃 tRPC 的那一批验的是**降级形态**；想看「有数据时长什么样」要先把工作台与应用的
  **同源**问题解决掉（见上一节）。这一档不是「还没做」，是**部署问题**
  ——`docs/guides/PRODUCTION-GAPS.md` 的 F6 挂着这条账的全貌。
- **不改业务目录**。`ui/` 之外的 story 是**加**在业务组件旁边的，不动组件本身的
  职责划分（规范 16 §16.2.3.9 记了「哪一档怎么写、哪一档刻意不写」）。
- **组件覆盖率满了也不等于「页面没变样」**。`ui/` 现在是 **99/99**，而那只说明
  「每个组件都被单独看过一眼」—— 真实页面在真实栈上的布局与配色**现在没有自动判据**
  （页面级像素基线已整档撤掉，见规范 11 §11.8），靠 review 看图。组件覆盖率补不了那一格。

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

**当前是 88/88，理由表已经清空。** 这件事值得说清，因为「表空」与「表被删空」
看起来一样：

- 清空掉的 5 条（`progress` / `sonner` / `error-boundary` /
  `dialog-overlay` / `dialog-width`）**逐条都是「补法」而不是「不能写」** ——
  例如 `dialog-overlay` 此前记的是「纯常量、没有可看的东西」，而它算出来的
  字符串**就是它的对外面**（那张串里同时有「铺满视口」与 `top-title-bar`，
  正是让位硬规则要求的形态），摆在画布上比「没有 story」更值；
- 判据因此从「表非空」换成了一条**双向不变式：表空 ⟺ 覆盖率已满** ——
  两边单独成立都不合法（表空而覆盖率不满 = 有人把理由删了；表满而覆盖率已满
  = 有人把干净的账留在了表里）。原判据会在表真的清空后**要求人凑一条假理由**，
  而凑假理由正是这套棘轮最不该鼓励的事。
- 「判据在空转」这个信号落回**实测**那一侧：分子分母都非空由扫描现算、
  「每个 story 都真的 import 到了组件」由用例核。

**加新的 story 之前先看这两条**：`ui/` 有 story 的组件数与基线比只许升不许降；
`ui/` 下**新增文件**时同批回答「它为什么没有 story」——有界面形态就补一份
（哪怕要用 Args 注入数据），没有就往 `NO_STORY_REASON` 写一行逐条理由。

**业务目录（`studio/` / `workshop/`）不在那张棘轮里**：它的分母只看 `ui/`。
那两棵树的铺法是**按「数据从哪来」分档**（纯 props / 结构化入参 / 运行期环境），
口径与「哪一档刻意不写」见规范
[16 §16.2.3.9](standards/16-shadcn-ui与表单校验.md#16239-业务目录studio--workshop的-story按有没有数据依赖逐件分档)。
无论哪一档，**派生量都不许在 story 里手抄**：百分比调 `stageProgressPct()`、
尺寸摘要调 `shotSizeSummary()`、脏数据结论调 `auditDraftElements()` —— 手抄的数字
在改了常量之后仍然「看着正常」，那是这一批最想消掉的假形态。

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
- 注入层的契约判据：`tests/storybook-data-sources.test.ts`（值源）、
  `tests/storybook-injection-layers.test.ts`（store / React Flow / 整屏容器）、
  `tests/storybook-message-center-sources.test.ts`（消息中心）、
  `tests/storybook-workflow-run-sources.test.ts`（工作流运行）—— 都进
  `FIXED_STRUCTURAL_TESTS`。它们守注册表接线、媒体名与磁盘双向对齐、「点目录进了
  tsc / eslint 的扫描面」这几件**悄悄失效时不会红**的事。守的是「接线还在不在」；
  「有没有真的画出来」由真浏览器逐 story 渲染核对。
- **写这类判据时，否定/在场断言一律「剥了注释 + 定位到具体那一处」**：实测多条
  断言自己先假绿过（`toContain` 被 import 行满足、被**子串**匹配满足
  （`subscribeWorkflowRunStoreX` 包含前者）、被解释口径的注释满足、
  非贪婪正则从更前面那颗同标签起匹配）。规范 16 §16.2.3.14 记了完整的四种形状，
  改这一族判据前先看它。
- 故事面的判据：`scripts/storybook-checks/story-surface.mjs` +
  `tests/storybook-story-surface.test.ts`（进 `FIXED_STRUCTURAL_TESTS`）—— 守
  「这份故事到底有没有把那个组件摆出来看」：`title` 缺了会按路径自动分组、
  真组件没接上就是摆了别的东西、必填 props 没 `args` 会在画布上抛、
  同目录两套分组前缀则让「按分组浏览」名存实亡。四种错法**构建全绿、画布也画得出
  东西**，所以只能靠判据。门禁在 `node scripts/storybook-check.mjs --changed`
  （pre-commit D 组就是这么调它的）。
- 枚举来源的判据：`tests/storybook-cva-variant-source.test.ts` 与
  `scripts/storybook-check.mjs`（共用 `scripts/storybook-checks/cva-variant-source.mjs`
  的纯函数，AST 判；详细口径见规范 [16 §16.2.3.4](standards/16-shadcn-ui与表单校验.md#16234-故事里的枚举清单从-props-派生不要从-cva-的返回值上取)）。
  它与下面那条配置契约**守的不是同一件事**：这条管「故事文件自己怎么写」。
- 配置契约的判据：`tests/storybook-config.test.ts`（进 `FIXED_STRUCTURAL_TESTS`）
  —— 它守的是那四种「**构建全都成功**」的错法：`stories` glob 写错（侧栏空着）、
  漏引 `globals.css`（无样式裸 DOM）、漏主题装饰器（只剩 dark 一态）、启动器漏
  `SKIP_ENV_VALIDATION`（崩在 `env.js` 却看不出与配置有关）。另有一条判的是
  **加载链路**：`.storybook/**` 里的相对 import 一律要带文件后缀。Storybook 10 用一个
  Node ESM loader 加载 `main.ts`（ESM 要求完整说明符），无后缀时它会替我们补上并**每
  补一次打一条 deprecation**；能跑，但告警会遮蔽真正的启动报错，且下个大版本会变成
  硬错误。那条判据直接调 Storybook 自己的 `addExtensionsToRelativeImports`
  （`storybook/internal/bin/loader`）点一遍 `.storybook/**` —— 它「要改写源码」就等价
  于「启动会打那条 deprecation」，规则随 Storybook 变，不另抄一份正则。
- 为什么启动要经 `scripts/storybook.mjs`：`SKIP_ENV_VALIDATION=1` 是那条链上
  注入的（历史原因：webpack 版的 `@storybook/nextjs` 会加载仓库根的
  `next.config.js`，而它第一行就是 `import "./src/env.js"` —— 缺 `.env` 时抛
  `MissingEnvFileError`，「只是想看一眼按钮长什么样」会被应用启动期的环境校验
  拦住）。组件预览不需要 `BETTER_AUTH_SECRET` / `DATABASE_URL`，所以注入这个开关
  绕开 —— 口径与 `playwright.config.ts` 的 webServer、CI 的 `pnpm build` 一致。
  **不改 `next.config.js`**：那份导入是应用启动期的真实约束，不是它写错了。
  **迁到 vite 框架之后这条注入仍然留着**（ISSUE #3372）：vite 版的框架只经
  `@next/env` 读 `.env` 文件、不读 `next.config.js`，所以今天它自己不会触发那条
  校验 —— 但注入是零成本的安全网，将来任何一个插件读回 `next.config.js`，
  这条历史坑不该再踩一次。
- **框架是 `@storybook/nextjs-vite`**（ISSUE #3372 从 webpack 版迁来）：官方在
  Storybook 11 已把 `@storybook/nextjs` 标记废弃、12 移除，推荐的迁移目标是
  `@storybook/nextjs-vite`（vite builder，去掉 webpack 与 Babel）。本仓跟着迁的
  理由不止「跟上上游」—— webpack 版还会把整条 webpack 链拖进依赖图
  （`@storybook/builder-webpack5` → `node-polyfill-webpack-plugin` →
  `crypto-browserify` → `elliptic`），迁走后 `pnpm why elliptic` / `pnpm why
  webpack-dev-middleware` 都是空输出，`pnpm-lock.yaml` 也净少约 3100 行
  （+1030 / −4140）。
  迁到 vite 后有两处**必须显式补上**的东西（都是「不补也不报错、只是静默不对」
  的形状，见 `.storybook/main.ts` 与 `.storybook/preview.tsx` 里那两段说明）：
  ① 应用 origin 的编译期内联改由 `viteFinal` 的 `define` 承担（vite 的 `env`
  落到 `import.meta.env`，落不到本仓读取面用的 `process.env`）；
  ② `next/navigation` 需要 `parameters.nextjs.appDirectory = true`
  （本仓只有 app 目录，按官方口径全局开）。
- 跨平台形态登记在 [launch-and-build.md §9.5](standards/launch-and-build.md#95-跨平台动作对照表ps1-与-mjs-不许分叉机器强制)。
