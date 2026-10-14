<!-- ⚠️ 本文件为自动生成产物（`pnpm doc:render`），请勿手改。
编辑态文档（单一事实 + 占位符）见：`docs/standards/03-样式与-tailwind.md`。改动请回源文件，再重新生成。 -->

## 3. 样式与 Tailwind

> 本项目使用 Tailwind CSS v4（`@theme` 配置）+ 少量 CSS 变量。样式规则的目标是：一致性、可维护性、暗色模式可切换。

### 3.1 Tailwind v4 规范类名写法

v4 支持任意透明度百分比直接写在斜杠后；方括号 alpha 是 v3 遗留写法，编辑器（suggestCanonicalClasses）会持续提示改写：

```tsx
// ❌ 旧写法：方括号 alpha 值
"hover:bg-white/[0.06]";

// ✅ 正确：任意百分比直接写（v4 canonical，编译为 color-mix 6%）
"hover:bg-white/6";
```

同类规范写法迁移还有六组（历史存量已清零，新代码禁止旧写法）：

```tsx
// 渐变更名：
"bg-linear-to-br"; // ✅ v4
"bg-gradient-to-br"; // ❌ v3 旧名

// CSS 变量任意值有专用简写：
"w-(--panel-right-width)"; // ✅ v4
"w-[var(--panel-right-width)]"; // ❌ v3 写法

// 负值：负号移入括号内（前缀负号是 v3 形式）：
"top-[-20%]"; // ✅ v4
"-top-[20%]"; // ❌ v3 写法

// 纯整数任意值用裸数字（z / order / duration 等数值工具类同理）：
"z-99"; // ✅ v4
"z-[99]"; // ❌ 多余括号

// 断词工具类 v4 更名（`break-words` 仍能编出，但已非 canonical）：
"wrap-break-word"; // ✅ v4
"break-words"; // ❌ v3 旧名

// important 修饰符写在**值后面**（前缀 `!` 是 v3 形式）：
"border-port-surface! size-2.5!"; // ✅ v4
"!border-port-surface !size-2.5"; // ❌ v3 写法
```

> **后两组为什么没进 codemod**（前五组由 `scripts/tw4-canonical-codemod.cjs` 批量迁移）：
> `!x` 在 JS 里与前缀否定同形（`!ok` / `!ready` 遍地都是），纯文本替换必然误伤；
> 它只能限定在 className 字符串内改，而「引号感知」这件事正则做不到既准又稳
> —— 误伤一行比漏一处的代价大得多。这一组靠编辑器（`suggestCanonicalClasses`
> 的快速修复）与 review 兜住，自查：`grep -rEn 'className="[^"]*![a-z]' src`（应为 0）。
> `wrap-break-word` 那条已进 codemod（`break-words` 这个 token 不是合法 JS 标识符，
> 全局替换不会撞上别的含义）。

同族还有一类「任意值可写成 spacing scale 倍数」（编辑器同样会提示，如
`min-h-[ 22px ]` → `min-h-5.5`，`5.5 × 0.25rem = 22px`）。它**不进文本 codemod**：
`text-[ 13px ]` 与 `h-[ 22px ]` 形态一模一样，但前者走 font-size、后者走 spacing，
按前缀猜必然改错量纲。判据交给 **Tailwind 引擎**，收在
`scripts/tw4-spacing-canonical.mjs`（幂等，dry-run 默认）：

- 换算后的裸数值候选必须**真能编出规则**（`candidatesToCss` 非空）；
- 它的声明里必须出现 `var(--spacing)`（= 该工具确实挂在 spacing scale 上）；
- 原候选本身也必须是合法候选。

三条同时成立才改写；换算前提（`--spacing` 仍是默认 0.25rem）由脚本自己断言，项目
一旦重定义就直接报错退出、不会改出一批算着错的类名。它同时按 P80 把同值
`w-K` / `h-K` 合并成 `size-K` —— 那是换算之后才暴露出来的形态（`w-[ 10px ] h-[ 10px ]`
在方括号里时 P80 数不到）。存量已清零，新代码按编辑器提示写。

> **这条不进钩子，但不再是一句谁都能忘的人为提醒**：`tw4-spacing-canonical.mjs` /
> `tw4-canonical-report.mjs` 都**不在** `.githooks/pre-commit`（它们要起 Tailwind
> 引擎、单次约 6s，且判断的是「CSS 等价改写」而非正确性，成本判据同 §13.5.4）。
> **实测的教训（数字是当时那次事故的账）**：storybook 那批新 stories 一次性带进来
> 「96 处」`w-[ 30rem ]` / `h-[ 32rem ]` 这类缩写候选（全仓现已各 0 处），直到手工跑
> `pnpm theme:scan` 才浮出来 —— 那时它只是「没人跑就没人
> 知道」。现在两者各带一个**硬闸判定档**（ISSUE #1451 要求 2 起步、ISSUE #1811 的
> tw4 项翻成硬闸，规范 §13.5.12）：
>
> ```bash
> node scripts/tw4-canonical-report.mjs --check   # 源文件 canonical 候选数须为 0
> node scripts/tw4-spacing-canonical.mjs --check  # 待改写处数须为 0
> ```
>
> 两者**都不再有基线**（曾经各带一份 `total: 0` 的棘轮，ISSUE #1811 翻闸时删掉）：
> 存量清零之后棘轮的两个动作都无事可做，留下的却是一条「手改那份 JSON 就能把新候选
> 登记成已知存量」的通道 —— 那正是硬闸类本来没有的中间态（§13.6.2 的两类对照）。
> 红了就 `--write` 落盘；测试文件里的候选按人判断（`--write` 默认不碰，见脚本头注）。
> 硬闸形态由两份用例守着：`tests/tw4-canonical-ratchet.test.ts`（**形状** ——
> 判定档还在、放宽通道没被加回来、扫描走共享内核）与
> `tests/tw4-hardgate-behaviour.test.ts`（**行为** —— 真候选即退 1、注释里的示例
> 不算候选、`--update` 这个出口已经不存在；形状守卫读文本，判不出「判定档真的会
> 退 1」）。执行者与「为什么不进钩子」登记在 `scripts/.gate-executor-ledger.json`。
>
> **翻闸时撞出来的两件事值得记在这**（tw4 这一项不只是删基线）：
>
> ① 两份工具的字符串字面量取法此前各写一遍「全文件正则」，于是**注释里用反引号引的
> 示例与真 className 同形**、被当成候选。修法是从两处收成一处
> `scripts/tw4-scan-core.mjs`：扫描前先按逐字符状态机**剥注释**（保长、保换行），
> JS/TS 走它、`.css` / `.snap` 仍按字面量粗取。这不只是少一条误报 —— 剥之前那份
> 正则还会被注释里的引号**打乱配对**，把注释之后**真的**类名字符串整段漏掉。
>
> ② 上面这件事修好之后 `WorkflowNode.tsx` 当场浮出 2 处**真**候选（`px-[ 14px ]` → `px-3.5`、
> `h-[ 43px ]` → `h-10.75`）—— 它们一直合规地存在，只是被 ① 那句配对错位挡住了。
> **「判据报了不该报的」与「判据漏了该报的」常是同一个根因的两面。**

**「更名 / 别名 / v3 遗留」那一类**（`!x`、`break-words`、`flex-shrink`、
`overflow-ellipsis`、`bg-gradient-to-*` …）由 `scripts/tw4-canonical-report.mjs`
汇总：它直接问 design system 的 `canonicalizeCandidates`「有没有另一种写法生成
**完全相同**的 CSS」，与编辑器的 `suggestCanonicalClasses` 同源。正因为判据是
「CSS 相同」而不是「长得像 spacing 工具类」，`text-[ 13px ]` 不会被误报成
`text-3.25`（那不是等价替换，是改量纲）。它与上一条**互补**：各扫一类，互不重叠
——`canonicalizeCandidates` 不认 `[22px] ↔ 5.5`（一个是字面量、一个是
`calc(var(--spacing) * …)`，不逐字相同），而上一条不认更名类。

**规则**：透明度一律 `/百分比`（小数合法，如 `/1.5`——tailwindcss 内部正是以 `parseFloat(alpha)*100` 做规范化的）。

#### 3.1.1 语义颜色一律写类名，禁止 `X-(--color-…)` 内联变量

v4 的 `bg-(--color-canvas-deep)` 这种「属性前缀 + 内联变量」写法**能编出 utility**
（`background-color: var(--color-canvas-deep)`），`hover:` / `dark:` 修饰符也**生效**。
所以它不是「编译不过」，而是**越过了语义层**：

- **拿不到语义名**：`text-(--color-ink-muted)` 与 `text-ink-muted` 是两份 class，
  同一处设计改一处漏一处；@theme 里的 token 改名/换值，内联写法**不会**跟着变。
- **拿不到该 token 的兄弟**：`border-(--color-canvas)` 的真实意图是「端口的载体色」，
  但 canvas 是**画布背景** token —— 浅色下画布浅灰、描边与端点糊在一起。
  写成类名时才会被迫问一句「我该用哪个 token」，进而发现缺一个
  `--color-port-surface`。内联变量把这个设计问题藏起来了。
- **`typecheck` / lint 看不见**：类名写错会被 Tailwind 的 canonical-class 提示抓到，
  变量名写错只是一个不生效的声明。

```tsx
// ❌ 属性前缀 + 内联变量：编得出来，但绕过语义层
"bg-(--color-node-accent) border-(--color-primary)/35 text-(--color-ink-icon)";

// ✅ 语义类名（@theme 里 --color-* 会自动生成；% 透明度同样适用）
"bg-node-accent border-primary/35 text-ink-icon";
```

**这条现在有机器执行者**（`scripts/check-theme-colors.cjs`，`pnpm theme:check`，硬闸、
存量 0）：判据形状只认一个 —— `-(` 紧邻 `--color-…)`，也就是上面那一族写法。
下面这几条边界要说清：

- **扫描面是 `src/**` 的 `.ts` / `.tsx`**（与本脚本其余判据同一面），且**只看代码行**
  （去注释后）。这一道在承重：组件文件里写一句「原写法是 `border-(--color-canvas)`、已
  token 化、勿回退」的说明注释**不该被自己判红**，有用例钉它必须通过。
  ⚠️ 别把这条边界安在 `globals.css` 上 —— 那处反例散文不红是因为 **CSS 根本不在这一条的面上**。
- **这一面不覆盖 CSS 侧的 `@apply`**：`@apply bg-(--color-node-accent)` 也能写出同一族
  越层写法，本条看不见（实测今天面上 3 条 `@apply`、0 条带 `--color-`，所以这是「面划在
  这里」而不是「已经在漏」）。要扩这一面得先回答「CSS 的注释怎么剥」—— 脚本里的
  `stripComments` 是按 JS/TS 写的，别顺手加。
- **只认 `--color-` 前缀**，刻意不扩成「任何 `-(--x)`」：非颜色那半
  （`w-(--panel-right-width)` 这类）没有对应的语义层主张，扩它等于替别人立新规。
- **它补的是另外几条判据的共同盲区**：这类写法编得出来、`hover:` 也生效、那颗变量
  又确实有定义 ⇒ 未豁免写死色值、幽灵 token 两条全绿。文档里那句「能不能写成类名」
  是**人读的口径**，这一条是它的机器形。

**允许保留 `var(--color-…)` 的两类场景**（都在 `style={{}}` 里）：

1. **动态计算值**：值由运行时数据决定，Tailwind 静态提取不可能覆盖 ——
   连线 stroke、节点 accent 色、`boxShadow` 里的色相；
2. **需要非 Tailwind 属性承载**：React Flow 的 `maskColor`、`Handle` 的
   `borderColor` 这类组件 props。

这两类**也要给随主题的 token**，不要把「浅色观感」写死成兜底值：
`var(--color-ink, #EDEDF2)` 的兜底只在变量未定义时生效，看着像浅色安全，
实际永远取不到；真正需要两态时，就该像 `--color-port-surface` 那样
**新增一个 token 并两态赋值**，而不是挑一个「深色下大概能看」的兜底。
**这条也有机器执行者**：同一份脚本的「已定义 token 上的色值兜底」判据，形态与边界
（只认色值字面量兜底、`var(--color-x, currentColor)` 属已放行写法）见 §3.6.1.1。

> 判据很简单：**能不能写成一个类名？** 能，就必须是类名。
> 只剩「值在运行时才知道」时才落 `style={{}}`。

### 3.2 避免魔法字符串：提取到主题/Design Token

```tsx
// ❌ 错误：魔法透明度值散落各处
"bg-white/4 hover:bg-white/8 border-white/6";

// ✅ 方案 A：@theme 扩展语义色（Tailwind v4 用 CSS 配置，见 src/app/globals.css）
// @theme { --color-surface-1: rgba(255,255,255,0.04); }
// 组件里用 bg-surface-1 引用，禁止直接写 bg-white/4 散落各处

// ✅ 方案 B：用 cva 管理变体（推荐用于复用按钮/面板）
import { cva } from "class-variance-authority";
const panelVariants = cva("rounded-2xl border transition-colors", {
  variants: {
    tone: {
      default: "bg-white/2 border-white/6",
      active: "bg-violet-500/10 border-violet-500/30",
    },
  },
  defaultVariants: { tone: "default" },
});
```

### 3.3 Tooltip 必须加 z-index —— 且取自刻度表

```tsx
// ❌ 错误：tooltip 可能被右侧内容覆盖
<span className="absolute left-full ml-2 ...">

// ❌ 也不对：随手挑一个数，等于又编一档（谁也说不清它比谁高）
<span className="absolute left-full z-50 ml-2 ...">

// ✅ 正确：层级取自浮层刻度表（16 §16.2.5）
<span className="absolute left-full z-popup ml-2 ...">
```

**层级不是一个「随便挑个够大的数」的自由参数**：它是**刻度表**里的一档 ——
`z-base` / `z-canvas-ui` / `z-canvas-max` / `z-modal` / `z-popup` / `z-toast`
（行内写法用 `Z.*`，见 `src/lib/shell/overlay-z.ts`）。见
[16 §16.2.5](16-shadcn-ui与表单校验.md#1625-浮层层级是一张刻度表issue-672-p2--p4机器强制)；
写了表外的数由 `pnpm ui:overlay-z` 在提交阶段拦下。

### 3.4 图标统一用 lucide-react

```tsx
// ❌ 错误：内联 SVG 导致视觉噪音、风格不一致（strokeWidth 有的是 1.8 有的是 2）
<svg
  width="20"
  height="20"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  strokeWidth="1.8"
>
  <path d="..." />
</svg>;

// ✅ 正确：统一图标库（tree-shakeable、风格一致）
import { Home, Zap, FolderOpen, Search, X } from "lucide-react";
<Home size={20} strokeWidth={1.8} />;
```

**数据驱动的图标名**（API 返回字符串 key、配置项/数据模型选图标）走中央解析组件，不直接 import：

```tsx
// ✅ 动态 key：中央 Icon 组件（src/components/ui/icon.tsx，内部已带 aria-hidden）
import { Icon } from "@/components/ui/icon";
<Icon name="plus" size={16} strokeWidth={2} />;
```

新增图标时先在 `icon.tsx` 的 lucide import 与 `ICON_MAP` 各加一行再使用；静态图标直接 import lucide，动态/可序列化 key 一律走 `<Icon name>`。

**例外**：项目品牌图标、复杂插画、需要精细控制的装饰性 SVG（如 Aurora 极光晕）可保留内联 SVG/组件。

### 3.5 CSS 注入用静态文件，不用 JS 动态注入

```tsx
// ❌ 可接受但不推荐：模块级变量防重复注入，代码分割后可能失效
let INJECTED = false;
if (!INJECTED) {
  document.head.appendChild(style);
}

// ✅ 正确：放到 globals.css 或独立 .css 文件 import
import "@/styles/json-viewer.css";
```

**AuroraBackground 模式**：极光装饰光晕作为可复用装饰组件集中管理（`AuroraBackground.tsx`），不要在多个页面内联重复相同的 radial-gradient 块。

**门禁（机器强制）**：`scripts/check-inline-style.cjs`（pre-commit 与 CI）扫描 `src/**`，
渲染出的 `<style>` 一律阻断——判据只看「有没有 `<style>` 元素」，不做按文件豁免
（只有注释里解释历史写法的引用放行，因为那是口径本身）。
这条判据来自**同一个形态在本仓库犯过两次**：`WorkflowEditorCanvas` 与
`ui/code-block` 的 `CODE_BLOCK_CSS` 都是「组件私有 CSS 字符串 + 渲染时注入」。
第一次改完只留了注释说明，第二次照样犯 —— 所以必须有机器判据，而不是「下次记得」。
回归测试见 `tests/check-inline-style.test.ts`。

### 3.6 暗色模式与 CSS 变量

```css
/* ✅ 语义化 token，暗/亮模式切换只改 token 值 */
:root {
  --color-surface-0: #0a0a0f;
  --color-surface-1: rgba(255, 255, 255, 0.02);
  --color-ink: #e5e7eb;
  --color-ink-muted: #8b90a8;
}
```

- 组件样式只引用 `var(--color-*)`，不直接写死 `#0a0a0f` 之类的色值（极光等装饰性渐变除外）。
- 新增颜色前先检查是否已有语义 token 可复用；没有再在 `@theme` 中扩展。

#### 3.6.1 固定暗色清单（新增表面时的判据）

本应用默认**随主题走**：所有表面引用语义 token，Light / Dark 两态各自取
值。唯一允许「无论主题都保持暗色」的是**固定暗色清单**，其权威副本是
`src/app/globals.css` 里的 `固定暗色清单（Fixed-dark inventory）` 注释块。
本节只规定判据与维护方式，条目以 `globals.css` 为准。

> 本应用**没有任何界面是「暗色品牌页」**：登录页、错误页、404 一类的独立
> 视觉页面同样走 token，不得以「品牌页」为由豁免。整屏或结构性表面（页面
> 底、卡片、面板、控件、状态栏）一律不进清单。

**准入判据（两条都满足才可进清单）**：

1. 该表面是「**内容视图内的极小面积叠层**」——浮在画布/预览/媒体之上的一
   小块说明或装饰，不是页面、面板、控件这类结构性表面；
2. 换成浅色会破坏其**承载对象**的可读性——典型是叠在图片/视频预览上的
   文字，浅底会与内容糊在一起。

两条有一条不满足，就必须走 token，**不得**进清单。

**已明确不属于固定暗色**（历史误判，已 token 化，勿回退）：

| 表面                                                                                                                                                   | 应使用的 token                                                                                                                                                                                                                                                                                                                                                             |
| ------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ReactFlow 缩放/适配/锁定控件 `.react-flow__controls-button`                                                                                            | `--color-node` / `--color-border-strong` / `--color-ink-muted`                                                                                                                                                                                                                                                                                                             |
| MiniMap 非视口遮罩（`maskColor`）                                                                                                                      | `--color-canvas-minimap-mask`                                                                                                                                                                                                                                                                                                                                              |
| 原生 `<select>` / `<option>` 与滚动条                                                                                                                  | `color-scheme` + `--color-node` / `--color-ink-field`                                                                                                                                                                                                                                                                                                                      |
| 登录页整屏底 + 极光                                                                                                                                    | `--color-bg` + 两态极光                                                                                                                                                                                                                                                                                                                                                    |
| 端口圆点描边 / 内圈高光（`border-(--color-canvas)` + 25% 白 `inset`）                                                                                  | `--color-port-surface`                                                                                                                                                                                                                                                                                                                                                     |
| 端口内圈光晕（`flow-focus-endpoints` 的 `portDotGlow`）                                                                                                | `--color-port-halo-ring` / `--color-port-halo-ring-weak`                                                                                                                                                                                                                                                                                                                   |
| 项目画布 MiniMap / Background / Controls（`#0D0818` / `#0B0712` / 25% 白点阵）                                                                         | `--color-canvas-minimap-mask` / `--color-canvas-grid-dot` + `.react-flow__controls*` token 规则                                                                                                                                                                                                                                                                            |
| 工作流画布底色 `CANVAS_BG`（写死 `#0a0a0f`）                                                                                                           | `--color-canvas`                                                                                                                                                                                                                                                                                                                                                           |
| 画布标尺文字 / 连线中点圆点（85% 近白字 + 深色 text-shadow / 纯白点）                                                                                  | `--color-canvas-ruler-ink` `-shadow` / `--color-edge-hub-dot`                                                                                                                                                                                                                                                                                                              |
| 子图标题栏混色基准（写死 `#16161E` 作为 `mixHex` 基色）                                                                                                | `--color-node-mix-base`                                                                                                                                                                                                                                                                                                                                                    |
| `JsonViewer` 的 `react18-json-view` 主题（`dark` prop + `jv-theme-comfy` 暗色档）                                                                      | 两态 `--json-view-*` token（浅色默认 + `.dark` 覆盖）                                                                                                                                                                                                                                                                                                                      |
| `CodeBlock` 的 shiki 主题（写死 `one-dark-pro`）                                                                                                       | 按 `resolvedTheme` 在 `one-dark-pro` / `github-light` 间切换                                                                                                                                                                                                                                                                                                               |
| `lib/markdown/styles.ts` 内联 style（便签 / 剧本 Markdown）                                                                                            | `--color-md-*` token                                                                                                                                                                                                                                                                                                                                                       |
| 类型 chip 的载体底（`WorkflowNodeArdot` 与 `WorkflowPortHandle` 的 `portChipStyle` 都曾写死 `#1E1A2E` / `#331A28` / `#26262E`）                        | `--color-chip-type-image-bg` / `--color-chip-type-video-bg`（中性档用 `--color-border-strong`）；chip **文字**仍是类型色，**底色**是表面。同一形态在本仓库犯过两次（先只改了 `WorkflowNodeArdot`），改一处要同时扫 `portChipStyle`                                                                                                                                         |
| 项目画布浮层工具条底（`CanvasToolbar` 的 `to-[ #16121f ]/85`）                                                                                           | `--color-panel/85` + `--color-shadow-strong`                                                                                                                                                                                                                                                                                                                               |
| 节点 JSON 浮层的 accent / chip 色（写死 `#7C5CFC`/`#5BC6FF`/`#ec4899` 等）                                                                             | `--color-primary` / `--color-info` / `--color-accent-soft` / `--color-ink-faint` / `--color-success-strong` / `--color-warning`（带透明度用 `color-mix()`）                                                                                                                                                                                                                |
| 「本机 / 在线」状态点与文字（写死 `#33D499`）                                                                                                          | `--color-status-online`（浅色 = `#047857`，与 `emerald-700` 同值）                                                                                                                                                                                                                                                                                                         |
| 画布**网格线**三处各写一份：编辑器两处写死 `rgba(148,163,184, α)`、库预览一处写 `var(--color-canvas-grid-line, …)` 而那颗 token 从未定义（永远走兜底） | `--color-canvas-grid-line` **两档**（浅色 = 黑，与 `--color-canvas-grid-dot` 的浅档同约定；深色 = `rgb(148 163 184)` 原值 ⇒ 深色像素不变），α **留在调用处**经 `canvas/workflow-canvas-grid.ts` 的 `gridLineColor()` 用 `color-mix()` 现取。实测：细线默认档 α=0.22 时浅画布上从 **1.18:1 → 1.68:1**，主参考线 α=0.14 从 **1.11:1 → 1.38:1**（改前浅色反而比深色更看不见） |

> 判据的用意：**控件**是结构性表面（用户要操作它），跟主题走才不会在浅色
> 下变成「深底深图标」的隐形按钮；**叠加在内容上的说明层**才是例外。

**类型色例外（Type-color exemption）**

固定暗色清单里还有一条**不是「暗色表面」**的例外：**类型色 / 类别色 / 端口
色的常量表**。典型落点：`src/lib/comfyui/types.ts`（32 个 ComfyUI 端口类型
色）、`config/custom-nodes.ts`、`lib/comfyui/node-registry.ts`、
`CanvasNodePrimitives.tsx` 的 `PORT_STYLE`、`WorkflowPortHandle.tsx`、
`lib/project-canvas/canvas-types.ts`、`workflow-param-mapping-ui.ts`、
`project-canvas/WorkflowNodeArdot.tsx` 的 `PORT_TYPE_COLORS` / `PORT_DOT_SHADOW`、
`workflow-library/workflow-library-wire-graph.ts` 的连线状态色常量
（`MANUAL_STROKE` / `DRAG_STROKE` / `SELECTED_STROKE`）
等（全库约 320 处，成组出现）。

> **连线状态色按「类型色」判**：一条边的描边色表达的是「这条线是什么状态」
> （已连上 / 拖动预览 / 选中），与端口类型色同属「内容自身的
> 颜色」——它画的是线，不是承载线的表面。`WorkflowParamWires` → React Flow
> 的改造（ISSUE #529）把这份常量表从 `WorkflowParamWires.tsx` 搬到
> `workflow-library-wire-graph.ts`，判定口径不变。

它们**允许保留写死色值**，理由三条：

1. **它们不是表面，是内容**：一个 8px 端口圆点、一层粉彩渐变、`Handle` 的
   `borderColor`，表达的是「这个端口属于哪个类型」——色值本身就是语义 id，
   不是页面/面板/控件那类结构性表面，判据 1 意义上连「叠层」都不是；
2. **换成浅色档反而更差**：这些点大多叠在图片/视频/画布预览上，浅色档与
   浅色内容糊在一起（同判据 2）；
3. **token 化会更难维护**：32 个端口类型各配一个 `--color-*` 只为「一次
   赋值、成组引用」，新增类型还要同步扩 token 表；成组集中的常量表是更
   合适的载体。

**边界（防止本条被滥用）**：只覆盖**成组集中的类型/类别/端口色常量表**。
组件里写着**表面或文字语义**的 `#hex` / `rgba(255,255,255,…)` —— 例如
`bg-[ #16161E ]` 的节点底、`rgba(255,255,255,0.18)` 的分隔点 —— **不属于**
本条，必须 token 化。判据一句话：**这行色值是「内容自己的颜色」还是「某个
表面的颜色」？** 前者可留，后者必改。

> **同一行里的文字色与底色要分开判**：类型 chip 是典型 —— chip 的**文字色**
> （`#a78bfa` 等，见 `workflow-param-mapping-ui.ts` 的 `PARAM_CLASS_COLOR`
> 与 `canvas-types.ts` 的类别色表）是端口类型色，属本条可留；chip 的**载体底**（原先写死
> `#1E1A2E` / `#331A28`）是「一块承载类型色的表面」，浅色下不能还是近黑，
> 必须 token 化（`--color-chip-type-image-bg` / `--color-chip-type-video-bg`）。
> 判据按「这一层画的是什么」逐层过，而不是按「这个文件里是不是类型色」整块放行。

**维护**：

- 增删条目时，`globals.css` 注释块、本表与**扫描脚本的豁免清单**三处同步改，
  并在 PR 描述里写明理由；
- 审查/提交前自查：新增的 `#rrggbb` 或 `rgba(255,255,255,*)` 是否属于清单
  条目？不是就换 token。

**机器化**：本节的判据不只写在文档里，还有一份**机器可读的豁免清单**——
`scripts/check-theme-colors.cjs` 的 `EXEMPT_TABLES`（类型色例外）与
`EXEMPT_FIXED_DARK`（固定暗色清单）逐条列出「文件 + 被豁免的顶层标识符 +
理由」，`node scripts/check-theme-colors.cjs` 据此把两类例外从扫描报告里剔掉。

```bash
pnpm theme:scan     # 只出清单（盘点/排批次用，不判失败）
pnpm theme:check    # 硬闸检查：豁免之外不得有未 token 化的写死色值（须为 0）
```

- **为什么要有它**：豁免此前只写在规范与 `globals.css` 注释里，是人读的口径。
  扫描器没有机器可读的豁免清单，于是同一批类型色（端口类型色 / 节点类别色 /
  参数分组色）每轮扫描都被当漏网再报一遍，白耗一轮。
- **豁免必须显式**：清单逐条列出「文件 + 顶层标识符 + 理由」，不做「按目录 /
  按关键字通配」的模糊放行 —— 模糊放行会让真正的漏改混在豁免里悄悄溜过。
  成组常量表以外的落点（哪怕同样是类型色，如函数体内联）也**不要**顺手加豁免。
- **硬闸**：豁免之外**不得**有未 token 化的写死色值（须为 0，命中即阻断）。
  翻转前它是棘轮（`scripts/.theme-color-baseline.json`，`total: 0`，`--update` 收紧）
  —— 存量清零后棘轮只剩一条「手改那份 JSON 就能把新色值登记成已知存量」的通道，
  而硬闸类**本来没有**这个中间态。**出口只有两个**：就地 token 化，或按上面的
  口径登记进 `EXEMPT_TABLES` / `EXEMPT_FIXED_DARK`（逐条写理由）——
  **没有「放宽基线」这个出口**。已接入 `.githooks/pre-commit`。
- **存量里混着「本该豁免的类型色」时怎么办**：余量里曾有一大批落在
  `workflow-node-palette` / `workflow-utils` / `CanvasNodePrimitives` 这类
  **端口类型色 / 节点类别色常量表**上 —— 按上面的类型色例外**本可豁免**，
  只是从未登记。**别把它留在「未豁免存量」里**：那样它既不是豁免、也不是
  待治理项，两边都不算。「豁免必须显式」的另一面就是**存量必须逐条定性**，
  登记进 `EXEMPT_TABLES`（带理由）或就地 token 化。
- **定性完毕的标志是存量归零**（ISSUE #672 已收口，`--report` 里未豁免存量与
  基线条目都是 0，判据随后翻成硬闸）。计数归零之后，**唯一能「让数字变漂亮又
  不改代码」的动作就是多加一条豁免** —— 豁免不计入计数，登记完就再也不会出现在
  报告里。所以 `tests/check-theme-colors.test.ts` 另钉一条：**每条豁免必须带
  说清「为什么这行色值是内容自己的颜色」的理由**，不能一句「类型色」了事。
- **两态外观常量表按类型色判**（新增口径）：`workflow-node-palette.ts` 的
  `LIGHT/DARK_ANCHOR_CYLINDER`（锚点圆柱的金属渐变）与
  `LIGHT/DARK_PALETTE_BASE`（混色数值基准，不是可见表面）整表登记豁免 ——
  判据仍是「这行色值画的是什么」：画的是**圆柱本体**（内容），不是承载它的
  表面。反过来，**底色写死成 `bg-[${color}/15]` 这类运行时模板不算豁免**：
  Tailwind 的 JIT 扫不到它，那条 class 从来就没生效过（`HomePage` 的类别
  底色就是此例，已改 `color-mix()` 现取）。

#### 3.6.1.1 豁免会过期，token 会落空（反向判据，机器强制；跨面相等主张在 §3.6.1.2）

上面的治理线把「写死色值」这一侧收成了零基线，但**它管不到反方向**：台账与实际
脱钩、以及「改成 token」这一步只改了一半。这几条都是**不报错的**失效，
所以同批补成机器判据（都在 `scripts/check-theme-colors.cjs` 里，硬闸、不进基线）。

> **下面的 ①②③ 只是本节内的编号，与脚本自己的分档编号不同源**（脚本按「豁免层 /
> 判定层 / 反向层 / 报告层」分层，反向层里还有几条）。要定位判据一律**按名字找**：
> 死豁免、幽灵 token、拼接 token 名、跨面相等主张、裸变量类名（§3.1.1）、
> 已定义 token 上的色值兜底（本节 ② 的后半）。

**① 死豁免 = 负债**。登记在 `EXEMPT_TABLES` / `EXEMPT_FIXED_DARK` 上、
却**一处都不再命中**的条目不是保险而是负债：它不会报错，只会把该文件
**今后**新写的死色值一并静默放行（整文件豁免的粒度尤其危险）。本轮实测清掉 4 条
—— 三个文件的色值只剩在注释里（判据本来就不数注释），一个早已 token 化。

- 口径是**按文件**、不是按条目：同一份文件可以有多条豁免（整文件 + 按顶层声明 +
  按行），命中归到谁头上取决于数组顺序，按条目判会把「被前一条遮蔽」误报成死条目。
  「整份文件都没东西可豁免」这个判定与顺序无关，所以只做这一层。
- 文件根本不在扫描面（路径写错）是另一件事，由 `tests/gate-hint-targets-exist.test.ts` 盯。

**② 幽灵 token：token 化必须是完整的一步**。把写死色值改成 `var(--color-x)` 时，
如果 `--color-x` 没有任何 CSS 声明，**CSS 不会报错**：`fill` 退成黑色初值、
`stroke` 退成 `none` —— 图标变黑块、描边类图形整条消失，比留一处写死色值更糟
（写死至少还是设计稿里那个颜色）。

实测事故：`ui/seed-mode-button.tsx` 的四枚 seed 图标在一次目录归并里从写死色值
改成了 `var(--color-seed-*)`，`globals.css` 却没补定义，从此静默失效若干轮。
**同一件事的两面**：那次改动让该文件的主题色豁免不再命中任何东西（①），
而 12 处 `fill` / `stroke` 引用查无此名（②）—— 是 ① 把 ② 暴露出来的。
补定义时**连本节的「两态各自取值」一起补**：那两颗红绿是深色面板上定的设计稿值，
而图标托在 `bg-node-accent`（浅色 = 极浅紫）上，照抄只有 **2.44:1 / 1.36:1**（红/绿，
真浏览器实测，见下）—— 已做成两档
（浅底 `--color-seed-fixed: #e11d48` / `-step: #059669`，深底沿用原值；骰子三颗
是图形自身、两态同值，不进 `.dark`）。

- 判据形态：**任何字面量** `var(--color-…)` 引用都必须在 `src/**/*.css`（`@theme`
  或 `.dark` 覆盖）里有声明；**被注释掉的声明不算声明**。门槛只有两个条件 ——
  字面量、带 `--color-` 前缀，**不关心它挂在哪个语法位置**（呈现属性、`style={{}}`、
  Tailwind `[var(--color-x)]`、`<Background color=…>`、收在出口函数里的模板串都算）。
  **带不带兜底值也一律判**（见下条）。实测：非测试代码里 175 处字面引用、
  查无定义 **0 处**；带兜底的 **0 处**。
- **带兜底的引用是「装饰性 indirection」，同样阻断**：`var(--color-x, #fff)` 里 x
  从未声明时，渲染结果确实确定（永远走兜底），所以它不属于「看不见」那一类失效 ——
  它的问题是**谎称随主题**：一行硬编码值挂着 token 的名字，把 §3.6.1 的「单一事实
  来源」悄悄换成局部常量，而且下一个人补上声明时这行会**静默改变外观**。
  上一版把带兜底列为「明确不覆盖」，而 `--color-canvas-grid-line` 正是靠那条豁免
  活了好几轮，所以这条豁免收回。
- **另一半：名字有定义时的兜底**（与上一条不重不漏，硬闸、存量 0）。
  `var(--color-ink, #EDEDF2)` 里 `--color-ink` 是声明过的 —— 于是幽灵判据比对得到、
  当场放过，而那行**永远取不到兜底**。它既不是 token 也不是写死值（那颗 hex 顺带会被
  「未豁免写死色值」抓到，**但那条在豁免文件里闭嘴**：§3.6.1 的类型色表照样能写出这种
  兜底），所以这一条**不看豁免表**：它判的是「这行是不是谎称随主题」，与那颗值归谁管无关。
  出路只有一条 —— 要两态就**新增一颗 token 并两态赋值**（`--color-port-surface` 就是这么来的）。
  三条边界，都有用例钉着，别顺手收紧：
  · **兜底只认色值字面量**（`#hex` / `rgb()` / `hsl()` / `oklch()` / `color-mix(` 那一族）。
    收成「任何兜底」会把 `var(--color-x, currentColor)` 一起判红 —— 那一族是**已判定放行**
    的防御性写法（SVG 的 stroke 拿 CSS 关键字兜底，不写「浅色下大概能看」的那个颜色），
    收紧它等于翻掉一个既有决定，不是补执行者。
  · 规定的取色写法 `useCssColorToken("--color-node-mix-base", "#ffffff")` 是**函数实参**、
    没有 `var(` 外壳，形态不同、这条不抓它。
  · **只看代码行**（去注释后）—— 与「拼接 token 名」同口径，`.ts` / `.tsx` 里讲这种写法的
    说明注释不该被自己判红（夹具把同一句散文写进 `.tsx` 的块注释，必须绿）。
    `globals.css` 里那处散文不红是**另一回事**：CSS 根本不在这两条判据的面上。
- **为什么不能按语法位置判**：第一版只认 `fill=` / `stroke=` 这类属性，于是
  `--color-canvas-grid-line`（从未定义，靠 `<Background color=…>` 的兜底活着）
  本来就抓不到；而把三处网格线**收进一个出口函数**之后，引用变成出口里的
  模板串、连属性形态都不是了 —— **集中化这个正确动作本身会让按形态判的判据失明**。
  这是本次改动实测踩出来的。
- **明确不覆盖**（别以为这条能抓所有未定义变量）：Tailwind 裸变量 `text-(--x)` /
  `w-(--x)` 与运行期注入的变量一律不判 —— 实测那种形态里
  「CSS 查无此名」是**常态**（base-ui 注入 `--transform-origin` /
  `--available-height`、宿主代码注入 `--sidebar-width`：310 处引用里 43 处如此），
  硬判等于造一台误报机（同 §12.18 那条「不要再写会静默失效的启发式扫描器」）。
  那部分留给 review。**能这么收窄是因为 `--color-` 命名空间干净**：实测全仓
  `setProperty` 与 style 对象键里都不出现 `--color-` 名字，即该前缀内没有运行期注入的
  正当用法 —— 如果哪天有人开始运行期注入 `--color-*`，这条判据要跟着改。
  **但别把这句「不覆盖」读成「没人管」**：同一族写法里
  `--color-` 前缀那一半有它自己的判据 —— 那是「越过语义层」问题、不是「查无此名」
  问题，机器执行者见 §3.1.1（裸变量类名，硬闸、存量 0）。

**③ 拼接 token 名：幽灵判据唯一看不见的引用形态**。`var(--color-aurora-${tone})`
或 `"--color-" + name` 拼出来的名字**不是字面量**，②那条判据无从比对「引用了哪个名字」。
而它同时踩中第二个坑 —— **Tailwind v4 会 tree-shake `@theme` 里没被引用的变量**，
且它判断「有没有被引用」看的也是**源码里出现过的字面名**。把 `globals.css` 真编译一次实测：

| 测量                                                   | 结果                                                         |
| ------------------------------------------------------ | ------------------------------------------------------------ |
| 往 `@theme` 塞一颗谁都不引用的 `--color-zprobe-unused` | 产物里出现 **0 次**（声明本身不算引用）                      |
| `globals.css` 声明的 111 颗 `--color-*`                | **24 颗被 shake 出产物**                                     |
| 这 24 颗在 `src/**` 里的字面名提及                     | **0 处** —— 被 shake 的全是零引用的，「字面提及 ⟹ 保留」成立 |
| 编译一次的成本                                         | 7.3~11.1s                                                    |

最后一行是**为什么不把产物侧断言做进门禁**的理由：既然「源码里有字面名」既是
②的判据条件、又是 Tailwind 的保留条件，两条就**等价**，为等价的东西付一次编译不值。
真正会翻车的是拼名 —— 而它一旦拼了，产物侧断言同样抓不到（名字没在源码出现过，
无从比对），所以只能**在源头禁止这种写法**。

实测抓到的那处是 `ui/aurora-background.tsx` 的 `AuroraGlow`：
`var(--color-aurora-${tone})`。**它今天还在正常渲染，纯属侥幸** —— 那三颗的名字在
同文件上半段与另一处（已删的训练工作室）的 `stroke=` 里恰好被整名写过，是**别人的代码**替它
保住了变量；哪天重构掉那几行，光晕当场失色、没有任何报错。已改成「整名 → 字面量」表
（`AURORA_TONE_VAR`），并补了该组件的第一条用例（此前零覆盖；表化唯一可能引入的新错
是抄错色相，而拼法与表法的运行时字符串**逐字相同**，所以「有没有拼」由静态判据守、
不由用例守）。

- 判据形态（两种，实测存量 0）：token 名里出现模板插值 `--color-…${`，或字符串相加
  `"--color-…" +`。**只判代码行**（去注释后），且**刻意不判**「反引号里出现 `--color-`
  前缀」这种宽形态 —— 它在 `globals.css` 的说明注释里命中 103 处散文引用，而那些名字
  恰恰是「没人用、活该被 shake」的正确形态。
- **JS 里按当前主题取色的规定写法**：`useCssColorToken("--color-node-mix-base", "#ffffff")`
  —— 整名写全。该地基出口内部的 `getPropertyValue(name)` 是本仓库唯一合法的间接层
  （它是出口，不是绕开），两个调用点传的都是完整字面名。

**产物侧的最后一公里由 e2e 守**（`e2e/theme-token-consumers.spec.ts`，非提交前必跑层）

上面②③两条判据都在**源码**层面成立，但「源码里有声明」离「浏览器解析得到」还隔着
两步：Tailwind 的 tree-shake、以及 Next 处理 CSS 时的 `@source` 根与门禁脚本直连
`@tailwindcss/postcss` 是否一致。这一步只能真开浏览器量。该用例断言四件事：

| 断言                                                                                        | 实测结果（chromium / win32）                                                                              |
| ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| 10 颗「被呈现属性或 JS 取色消费」的 token 在**两态**下都解析得到具体颜色                    | 全解析 ✓                                                                                                  |
| **负控制**：不存在的名字必须读不到，且 `fill` 退成 `rgb(0, 0, 0)`、`stroke` 退成 `none`     | 逐字命中 ✓ —— ②那条判据写的静默失效形态由此在浏览器里被证实，不是推测                                     |
| 图标 token 对**它实际所托的表面**（`bg-node-accent`）≥3:1（WCAG 1.4.11 图形对象档）         | 浅底 `#e11d48` → **4.13:1**、`#059669` → **3.31:1**；深底 `#ff6b6b` → **6.09:1**、`#67e89d` → **10.95:1** |
| 「做成两档」不是空话：同一颗 token 两态取值必须不同                                         | 取值确实不同 ✓（原设计稿那两颗在浅底上只有 **2.44:1 / 1.36:1**，两档因此是必需的）                        |
| `color-mix()` 在 SVG `stroke` 位置解析得了（网格线走这条）                                  | 解析得到 ✓，但实测序列化成 **`color(srgb 0 0 0 / 0.14)`**（分量是 0~1 浮点），**不是** `rgba()`           |
| 经 `--xy-background-pattern-color-props` **二次代入**后仍是同一个色相（画布网格线的真路径） | 浅 `[0,0,0]` / 深 `[148,163,184]` ✓ —— 且负控制测出降级**取决于作用域**，见下                             |

⚠️ **「幽灵 token 的表现是 fill 退黑 / stroke 退 none」这句话只适用于直接引用**。画布网格线
走的是另一条：React Flow 把 `<Background color=…>` 写成自定义属性，样式表再
`stroke: var(--props, var(--xy-background-pattern-color, var(--…-default)))` 取它 ——
**三层带兜底的 var() 链**。内层 token 缺失时实测：

| 作用域                                                   | 降级结果                                      | 观感                         |
| -------------------------------------------------------- | --------------------------------------------- | ---------------------------- |
| `.react-flow` 之外（`…-lines-color-default` 不在作用域） | `stroke: none`                                | 网格线**直接消失**           |
| `.react-flow` 之内                                       | `stroke: rgb(238, 238, 238)`（xyflow 默认灰） | 看着像「网格线本来就这么淡」 |

两种都**不报错**。第二种比退黑更难发现 —— 所以判据不能停在「画面有没有变黑」，
只能靠静态那条（引用必须是已声明的字面名）+ 这条 e2e 的不变量（**幽灵 token 绝不会
解析成我们的色相**，具体退成什么由作用域决定，不断死）。

**这条用例刻意不比像素**（那条路现在也整个没有判据了 —— 像素基线层已撤掉，见 11 §11.8）。
颜色/层级这类「算出来的样式」用 `getComputedStyle` 断言，天然跨平台，而且抓的正是这一档要
抓的东西（幽灵 token 解析成什么），比整页截图**更靠得住也更快**。

**断言计算出来的颜色要比分量，不能比字符串**：`color-mix(in srgb, …)` 的计算值被
Chromium 序列化成 `color(srgb 0 0 0 / 0.14)` —— 保留 sRGB 色彩空间、分量是 0~1 浮点，
而普通 `var()` 解析出来是 `rgb()` / `rgba()`。拿 `/^rgba?\(/` 去断 `color-mix()` 会得到
一条「没解析」的红，**而值其实是对的**（本次实测撞出的假红）。用例里的 `parseColor()`
三种形态都认（`#hex` / `rgb()` / `color(srgb …)`）。

**α 烤进 token 还是留在调用处，取决于「谁定这个强度」**：点阵
`--color-canvas-grid-dot` 的强度是设计定死的 ⇒ 烤进 token（`rgb(0 0 0 / 0.22)`）；
网格线的强度是**用户在画布设置里调的**、还要再乘一个随缩放淡出的系数 ⇒ token 只给
色相，α 由出口 `gridLineColor()` 用 `color-mix()` 现取。两颗相邻 token 形态不同是
有意的，各自的注释都写了理由 —— **别顺手把它们统一成一种写法**。

```bash
pnpm theme:check    # 硬闸（命中即 exit 1 并点名文件行号）：未豁免写死色值 / 死豁免 /
                    # 幽灵 token / 拼接 token 名 / 跨面相等主张 / 裸变量类名 /
                    # 已定义 token 上的色值兜底 —— 条数不在这里记账，按名字找判据
```

#### 3.6.1.2 跨面相等主张：注释与豁免理由不是第二本账（ISSUE #1717，机器强制）

**事故形状**：用一句「与 `--color-primary` 同值」给一颗裸色值背书。token 一改，
这句话不会红 —— 实测：品牌紫深化把 `--color-primary` 从 `#7C5CFC` 改成 `#8557de`
（那一批是为了让白字压它够 AA），而四处这样的主张（**三条 `EXEMPT_TABLES` 登记理由 +
一处代码注释**）当场变成假话，`pnpm theme:check` 全程报「未豁免 0 处 ✓」：
它数的是裸值，**不读理由**。

**口径是禁止这种写法，不是校验它成立**：后者每次改 token 都要重算一遍，长出来就是
§12.18 明写不要的「扫豁免理由的启发式」。改法只有两条出路：

| 出路 | 什么时候用 | 结果 |
| --- | --- | --- |
| 写 `var(--color-primary)` / `var(--color-accent)` | 这行**确实归品牌管** | 跟着走是机制，不需要主张 |
| 删掉那句，改写语义来源 | 它是**独立的内容色**（类型色表、装饰表） | 不再跟品牌比大小 |

**判据形状**（收窄到品牌家族，别当宽形态用）：只认「与/跟 + `--color-primary*` /
`--color-accent*` + 同值|相等|1:1|同一个值|逐字节同」，外加真实发生过的变体
「与 globals.css token 1:1」。三条反控制同样钉在用例上，缺一条它就是误报机：
`var(--color-primary)` 的正确写法不命中、非品牌家族的散文
（`与 --color-subtle 在浅色主题下是同一个值`）不命中、`#609` 这类行号不被当成色值。
**扫描面是两处**：`src/**`（含注释）+ 本脚本自己的 `EXEMPT_TABLES` /
`EXEMPT_FIXED_DARK` 的 `reason` 字段 —— 这次的四处里有三处长在理由里，
只扫 `src` 等于覆盖一半。

**这次落地的分治**（一句话：**同一个紫色出现在两张语义表上，跟手的判据是「它归谁管」，不是「它长什么样」**）：

- **跟手**：`CanvasNode` 选中高亮环与两层光晕、`CanvasContextMenu` 的 W 徽标双色渐变。
  实测白字压旧品牌 `#7C5CFC` = **4.38**（不够 AA 4.5），压新 `#8557de` = **4.76**（够）；
  渐变终点 `#FF5CA8` 仍是 **2.86** —— 那一格不由本条解决，别把「徽标过 AA」写进结论。
- **不跟手**（独立内容色，注释改写成语义来源）：端口/类别类型色表 ——
  `WorkflowPortHandle`(4) / `WorkflowNodeArdot`(3) / `ContentAssetNode`(2) /
  `custom-nodes`(2) / `WorkflowSubgraphNode`(1) / `workflow-param-mapping-ui`(1)
  与它的 chip 用例(1)；`custom-nodes` 那两颗另有一层理由：对齐 litegraph 官方调色板。
- **`model-cover.ts` 单独定性为不跟手**：查过这张表里**没有「品牌封面」那个特权位** ——
  `#7C5CFC` 只出现在六支中的两支与空表兜底里，与蓝/绿/琥珀/青平级，取值靠
  `hash(id) % 6`。把它焊进 token 的后果是今后任何一次品牌调整**只带走六分之一张表**，
  用户看到「有几分变了、有几分没变」，比整张不跟手更难解释。
- **顺带收掉的一处第二记账**：`globals.css` 的 `--color-node-mix-base` 原本抄着 hex
  并注「与 `--color-node` 同值」⇒ 改成 `var(--color-node)`（两态实测同值：
  浅 `#ffffff` / 深 `#2b2b36`，所以换写法零像素差）。这与 §3.6.1 光晕那批「浅色档写成
  token 本体，抄 hex 会和源头各自漂移」是同一条规则的另一格。

⚠️ **这两处跟手的外观改动没有「整页像素回归」能证明改对了**：撤掉的是**页面级像素基线**
（见 11 §11.8），仍然有人管的组件那一侧是两层 —— Storybook 工作台（§16，看单组件在受控
props 下的形态与明暗两态）与 `getComputedStyle` 类断言（§11.3，钉 token 的**值**）。
所以防线不是只有「肉眼过一遍」：值那一层可以机器量，**整页有没有变形**才是真的没人管。
依据另有 WCAG 分量比 + 形状判据 + 单测。两紫之间的对比度差只有
**1.09**（观感是「深一点点」），所以验收要肉眼看过一遍选中环与徽标，不能只交绿。


### 3.6.2 品牌/状态色必须走语义 token（ISSUE #672，机器强制）

「改一处样式、全站生效」的前提是**颜色有单一事实来源**。实测出的反例：
`--color-primary`（那时有值 `#7c5cfc`）定义得好好的，但 `ui/confirm-dialog.tsx` 写死
`violet-500/600` 6 处、`ui/status-badge.tsx` 写死 44 处
`emerald/violet/amber/red`、`ui/page-loading.tsx` 写死 `border-violet-500` ——
把 primary 改成蓝色，这些地方仍然是紫的，视觉体系当场破功。

**判据一句话**：这行色值是「**表面/文字/状态的语义**」还是「**内容自身的颜色**」？
前者一律写语义类名（§3.1.1 已禁内联变量写法），后者才进 §3.6.1 的类型色例外。

```tsx
// ❌ 语义色写死：改品牌色时这行不会跟着变
"border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-400";

// ✅ 语义 token（token 自己两态取值，不必再手写 dark:）
"border-primary-500/30 bg-primary-500/10 text-primary-strong";
```

**状态徽标只有一处配色**（新增状态界面时照这个来）：状态 → 配色收在
`ui/status-badge.tsx`，状态 → 圆点收在 `ui/status-dot.tsx`；**文案留在调用处**
（同一个状态在不同界面叫法不同，那是业务文案，不是样式）。
此前七个文件各写一份「状态 → 配色」表，同一个「已完成」在不同界面是
`bg-emerald-500/15` / `bg-emerald-400/10` / `bg-emerald-100` 三种深浅 ——
改一次状态色要点七遍名。规范 16 §16.2.4.5 是这件事的台账。

**本项目已有的语义色 token**（新增前先查这张表，别再写死字面量）：

| 语义       | token / 类名                                        | 用途                                                                                                                                                     |
| ---------- | --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 品牌主色   | `--color-primary` → `primary`                       | 浅色底下当**底**用（`bg-primary/15`）                                                                                                                    |
| 品牌文字档 | `--color-primary-strong` → `primary-strong`         | 浅底上的品牌**文字/图标**（原 `violet-700` / `violet-400`）                                                                                              |
| 品牌实心档 | `--color-primary-500` / `--color-primary-600`       | 实心按钮底、spinner 描边（原 `violet-500` / `violet-600`）                                                                                               |
| 品牌浅底   | `--color-primary-soft`                              | 图标托底、选中项底                                                                                                                                       |
| 强调/品红  | `--color-accent` / `--color-accent-soft`            | 第二品牌色                                                                                                                                               |
| 成功       | `--color-success` / `--color-success-strong`        | 状态绿（原 `emerald-*`）                                                                                                                                 |
| 警告       | `--color-warning` / `--color-warning-strong`        | 待处理/排队（原 `amber-*`）                                                                                                                              |
| 危险       | `--destructive` / `--color-danger-strong`           | 失败/删除（原 `red-*`）                                                                                                                                  |
| 信息       | `--color-info` / `--color-info-strong`              | 链接/提示（原 `cyan-*` / `blue-*`）                                                                                                                      |
| 极光晕     | `--color-aurora-violet` / `-cyan` / `-magenta`      | 装饰性背景光晕的**色相**（强度由调用处决定）                                                                                                             |
| 节点参数值 | `--color-widget-value` / `--color-widget-value-dim` | 画布节点（WorkflowNode / 子图 / rgthree）参数行的值文本：未连线取主档、已连线取低一档（暗色档=纯白、已连线比纯白暗一档；浅色档不照抄白，否则白底上消失） |

**「同一个原色在两个位置上取不同值」是正常的，别用同一份写死值糊过去**：
品牌当**底**与当**字**要两颗 token —— 所以有 `--color-primary`（底）与
`--color-primary-strong`（字）。这条理由在品牌紫深化之后**更硬而不是更软**：
旧 `#7c5cfc` 白字压它只有 **4.38**（低于 WCAG AA 正文的 4.5，即实心 CTA 上的白字一直在
及格线下），深化后的 `#8557de` 是 **4.76**（刚过线），而「当字」那一档单独取 `#6230cc`
（**7.46**）—— 三个读数都在 `docs/DESIGN.md` 的 Colors 表与那张 WCAG 算式表里可复算。
写死的那一处无法表达这个区分，也无法让这种「一处改动全站跟手」的修正落到 CTA 上。
状态色同理：
`warning` / `success` / `info` / `danger` 各自都有「当底的原色」与
「浅底上当字的 `*-strong` 档」。

**这套区分直接决定 `Button` 的语义变体怎么写**（16 §16.2.4.1）：
`variant="warning"` 的底色取 `bg-warning/10`、文字取 `text-warning-strong`，
而不是两边都用 `amber-500`。

**「浅底上的字」与「深底上的字」是两颗 token，别互相借用**：例如影片时间轴
的片段底是**深色渐变**，上面的字要浅（`text-primary-soft` /
`text-warning-soft`，`--color-warning-soft` 两态同值）；而「浅底上的琥珀字」
用的是 `text-warning-strong`（深色下落亮）。两者在深色下取值接近、在浅色下
**相反** —— 借错了不报错，只是在浅色下看不清（同 §3.6.1 开头那段论证）。

**装饰性渐变/光晕**：色相进 token，**强度（alpha）留在调用处**。同一个极光晕
曾在登录页 / 首页 / `FilmStudio` 与训练工作室（已删）各抄一份、且值不同
（0.48 / 0.42 / 0.40），现在统一走 `AuroraGlow`（`tone` 选色相、`alpha` 定强度）——
与 §3.5 的「AuroraBackground 模式」是同一条要求：**同一个装饰不在多处内联重复**。

**机器判定**：`scripts/check-theme-colors.cjs`（`pnpm theme:check`，pre-commit 的
D 组「主题色扫描」这一步 —— 它**已是硬闸**，见 §3.6.1）。它认「写死的 `#rrggbb` /
`rgba(...)`」，而 Tailwind 类名形式的语义色类名本来就扫不到 —— 也就是说**本节的判据
靠「不要在源码里写字面量」实现**：只要颜色是类名，`theme:check` 与改名/换 token 都
不会有冲突。`EXEMPT_TABLES` / `EXEMPT_FIXED_DARK` 的豁免口径与 §3.6.1 完全一致。

> **写进 Tailwind 候选名里的 `rgba()` 同样在射程内**（这一条是修出来的，别退回）：
> 候选名用 `_` 代替空格，所以「`shadow` 的任意值写法里那段 `_rgba(`」——`rgba` 前面是**单词字符**，
> 判据若写成 `/\brgba?\s*\(/` 当场匹配不到 —— 这类裸值既不进豁免、也不进报告，
> 「未豁免 0 处」绿得毫无意义（实测漏过 6 处，含两处退役品牌值 `rgba(124,92,252,…)`、
> 一处旧 `--color-primary-500` 的 `rgba(139,92,246,…)`，以及一枚节点投影把深色档的
> `0.55` 恒定写死、浅色下照着用）。正解是不加边界：`rgb(`/`rgba(` 这两个词形本身已足够特指。
> 用例两侧同钉（`tests/check-theme-colors.test.ts`）：候选名里的裸值**必须红**，
> 同一行只把裸值换成 `var()`/`color-mix()` **必须绿** —— 后者要带上 `globals.css` 的声明夹具，
> 否则会撞上同脚本的「幽灵 token」硬闸，那条红得对但会把这条想测的东西盖住。
> 覆盖面仍不含 `hsl()`（实测产品面只有一处、且是运行时按色相现算的类别色模板），
> 要扩就连那条夹具一起扩，别只改正则。

> **3~4 位短写法（`#f00`）靠「颜色语境」收窄，别把它当成可省的守卫**：`#346` 这类
> **ISSUE 引用**与 3 位 hex 在字符集上完全同形（`346` 全是 hex 字符、长度也对），
> 所以短写法只在 `#` 前面出现过 `color` / `fill` / `stroke` / `bg-` 这类**颜色属性名**
> 时才算色值；5 位以上一律收（那种长度不可能是行号）。两侧都由
> `tests/check-theme-colors.test.ts` 钉住：短色值**必须红**、`ISSUE #NNN` **必须绿**。
> ⚠️ 这条守卫的失效形态与同类门禁不同 —— **把收窄删掉，短色值照样会被 `HEX_RE` 收到**
> （`{3,8}` 贪婪），于是「删掉限制」在「短色值是否被拦」这条断言上照绿，只有
> `ISSUE #NNN` 变成假红那一面才会响。历史上这里还留过一枚只声明不引用的
> `SHORT_HEX_RE`（ISSUE #1811 收尾时清掉的死常量）——**死的那半谁都不报、活的那半
> 「看起来还在工作」**，正是因此才把两侧都写成断言。

> **投影要两态，只能引 `--color-shadow-strong`**：Tailwind 把 `@theme` 的值**内联进 utility**，
> 实测 `.shadow-card` 编出来是 `--tw-shadow: 0 4px 20px var(--tw-shadow-color, rgb(0 0 0 / 0.18))`
> —— 浅色值被焊死进规则，`.dark` 里那颗 `--shadow-card: … 0.55` 只有直接写 `var(--shadow-card)`
> 的人才拿得到。写成 `shadow-[0_4px_20px_var(--color-shadow-strong)]` 才是运行期解析，
> 两态实测 0.18 / 0.55。这与 `--radius-*` 在产物里「半个幽灵」是同一格（见 `docs/DESIGN.md`
> 的 Elevation 与「已知缺口」两处），**判据要问「哪条 utility 真会去读这颗变量」，不是「声明了几态」**。

### 3.6.3 主题 token 的层叠顺序：浅色档不得用裸 `:root`

**判据**：同一个元素的同名自定义属性出现两处声明时，**特异性相同则由源码顺序决定**。
`<html>` 上同时有 `:root`（伪类，特异性 0-1-0）与 `.dark`（类，同为 0-1-0）——
两者写在同一份样式表里时，**谁写在后面谁生效**。

**因此：一个 token 的浅色档与深色档必须满足「浅色在前、深色在后」**，
或者给浅色档一个在深色下**不匹配**的选择器（本项目用 `:root:not(.dark)`）。
写成「深色档在前、浅色裸 `:root` 在后」时，浅色档会在深色下**恒定胜出**。

```css
/* ❌ 深色在前、浅色裸 :root 在后 → 深色下 --card 仍是 #ffffff */
.dark {
  --card: #16161c;
}
:root {
  --card: #ffffff;
}

/* ✅ 浅色档在深色下不匹配 */
.dark {
  --card: #16161c;
}
:root:not(.dark) {
  --card: #ffffff;
}
```

**这类故障 tsc / eslint / 主题色扫描器都看不见**：扫描器扫的是**写死色值**，
而这里的色值本身没问题，错的是 token 解析到了另一态。表现是「整套走该别名的
utility 在两态里各有一态取错值」——`bg-card` 编出来是
`background-color: var(--card)`（`@theme inline` 直接把别名内联进 utility），
`--card` 取错，**所有** `bg-card` 表面一起错。

- shadcn 语义别名（`--background` / `--foreground` / `--card` / `--popover` /
  `--secondary` / `--muted` / `--border` / `--input` …）的浅色档统一收在
  `globals.css` 末尾的 `:root:not(.dark) {}` 块，深色档在上方 `.dark {}` 块。
- 新增别名时**不要**另起裸 `:root`；要么并入该块，要么自己保证在 `.dark` 之前。
- 回归测试：`tests/theme-dark-token-cascade.test.ts`（真编译 `globals.css` +
  jsdom 解级联，断言每个别名两态取值不同），逐条覆盖上表别名。

### 3.6.4 项目 token 是唯一事实来源，别名只做 `var()` 转发（ISSUE #672，机器强制）

本项目的颜色命名有两条体系，**方向必须是单向的**：

| 体系            | 名字                                                     | 角色                              |
| --------------- | -------------------------------------------------------- | --------------------------------- |
| **项目 token**  | `--color-*`（`--color-surface` / `--color-ink-muted` …） | **唯一事实来源**，两态各自赋值    |
| **shadcn 别名** | `--card` / `--border` / `--muted` …                      | shadcn 基元要的名字，**只做转发** |

收口之前两者**各写一份字面量**（别名在 `.dark {}` 与 `:root:not(.dark) {}` 里
各一份），于是同一个颜色在库里有 **2~3 份拷贝**：把 `--color-surface` 改成别的，
`bg-card` 一点不动 —— 这正是「同一个组件样式不好改」的机器原因。

**判据（三条，`tests/theme-token-single-source.test.ts` 逐条守着）**：

- **T1 单向**：别名不写字面量，值必须是 `var(--color-*)`。别名自己写死颜色时，
  「改品牌色」要点名到别名这一层。
- **T2 不重名**：`@theme inline` 块里不许出现 `@theme` 已有的名字。重名 =
  项目 token 被别名顶掉（见下）。`--color-muted` 是**允许**出现在桥里的少数派 ——
  shadcn 的 `--muted` 是**表面**语义（`bg-muted`），项目侧对应 `--color-subtle`；
  项目原有的同名 `--color-muted` 是**文字**语义、且与 `--color-ink-muted`
  逐字节同值，已删除。名字腾空之后它不再是「重定义」。
- **T3 无环**：`var()` 链必须无环、不指向未定义的名字。`--color-X: var(--X)`
  配 `--X: var(--color-X)` 会让两边同时变成无效值。

**T2 不是风格偏好，是实际踩过的坑**：`@theme inline` 里曾有
`--color-primary: var(--primary)`、`--color-accent`、`--color-muted`、
`--color-border` 四行。名字在编译产物里出现两次，本块（层内靠后）获胜，于是
**项目 token 的含义被静默换成了别名**：`var(--color-muted)` 在浅色下取到
`#f7f8fa`（近白表面）而不是 `#6b6b76`（文字灰），`globals.css` 的 `.u-chip` /
`.u-ghost` 与 `WorkflowNodeJsonPopover` 的那些小字在浅色下几乎看不见。
**tsc / eslint / 主题色扫描器全绿** —— 扫描器扫「写死的色值」，而这里色值本身
没问题，错的是 token 解析到了另一处同名声明。

**别名不按主题分叉**：转发形态下别名只需声明**一次**，两态取值由项目 token
负责。因此 `:root:not(.dark)` 那个「深色下不匹配」的技巧对别名不再必要
（§3.6.3 讲的层叠陷阱仍适用于项目 token 自身：浅色档用裸 `:root`、深色档用
`.dark` 时，浅色档会恒压深色档）。

**新增一个颜色时**：先在 `@theme` 加 `--color-*`（两态各取值），再看 shadcn
基元是否需要别名 —— 需要就在 `:root {}` 加一行转发、并在 `@theme inline` 加一行
桥。**产品代码一律用项目 token**，别名只给 `ui/` 基元用。

**取值口径**：`tests/helpers/theme-tokens.ts` 真编译 `globals.css` 产物，自己实现
级联 + `var()` 链解析。**不要改用 `getComputedStyle`** —— jsdom 不解析 `var()`，
别名改成转发后会返回字面量 `"var(--color-surface)"`，断言会全部变成误报
（实测过）。本文件的做法在 Chromium 里逐项核对过。

### 3.7 装饰性元素可访问性与性能

```tsx
// ✅ 装饰背景/光晕：pointer-events-none + aria-hidden
<div
  aria-hidden
  className="pointer-events-none fixed inset-0 -z-10 overflow-hidden"
>
  <div
    className="absolute rounded-full mix-blend-screen ..."
    style={{ background: "radial-gradient(...)" }}
  />
</div>
```

- `pointer-events-none`：防止光晕/背景拦截画布点击、拖拽。
- `aria-hidden`：对屏幕阅读器隐藏纯装饰元素。
- `fixed + -z-10`：装饰层不参与文档流，不引发重排。

### 3.8 响应式断点覆盖

```tsx
// ✅ 关键布局至少覆盖 sm/md/lg 三档
<div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
```

**规则**：画布/编辑器类页面默认桌面优先（`lg:` 为主）；公开落地页/文档页必须移动优先（`sm:` 起步）。所有 `absolute` 定位的浮层（抽屉、popover、tooltip）需测试在 ≤1280px 视口下不溢出。

#### 3.8.1 一排控件不许被「压扁」——窄了换行或收窄，不许变形

横向工具条（顶栏、按钮排、筛选行）在窄窗口下最常见的事故不是溢出，而是**变形**：
flex 默认 `flex-shrink: 1`，宽度一紧张就从每个子项身上按比例抠，抠到文字改行、
按钮变成两三行竖排小字、圆角随之消失（ISSUE #404 的工作流编辑器顶栏）。

```tsx
// ❌ 会被压扁：默认可收缩 + 文字可换行
<button className="rounded-lg border px-4 py-2 text-sm">编辑 IO</button>

// ✅ 不换行、不收缩；宽度不够由容器换行、或本例的「先收内边距」承接
<button className="shrink-0 whitespace-nowrap leading-none px-2.5 py-1.5 text-xs
                   md:px-4 md:py-2 md:text-sm rounded-lg border">
  编辑 IO
</button>
```

三条硬规则：

1. **`whitespace-nowrap`**：文字是一整块。压不下就换行（`flex-wrap`），不是把
   「编辑 IO」拆成三行。
2. **`shrink-0`**：按钮是可点目标，不该被压。要挤，挤可截断的那块（带 `truncate`
   的长标题）。
3. **`leading-none`**：图标（emoji / lucide）的行框高于中文字号，默认行高会把
   按钮顶高、图标不居中。

**收窄的策略**：优先收**内边距**（`px-4 → px-2.5`）与**图标间距**（`gap-1.5 → gap-1`），
字号最多降一档且必须**在断点处回升**（`text-xs md:text-sm`），不能永久变小。

**兜底顺序**（宽度不足时按此顺序退化，绝不压扁控件）：
收内边距 → 降一档字号 → 整排换行（根容器 `flex-wrap`）→ 溢出滚动。

> **换行触发的前提**：可缩容的兄弟块必须有**贴着按钮组实测宽度的最小宽度**
> （如 `min-w-[ 170px ]`）。带 `truncate` 的标题其 min-content 只有一两个字符宽，
> 没有下限时 flex 会认为它「还能再压」，按钮组永远等不到换行、只能被压到与
> 标题重叠；下限给太大（相对按钮组天然宽度）则会在明明排得下的时候过早换行。

**同构的成排按钮抽一份判据**：同构的按钮排（典型是「状态行」：左侧状态文字 +
右侧一排动作按钮，ComfyUI / Drizzle Studio / Ollama 三处同构）不要再各自拼
class——抽成一份导出（常量 + 拼串函数 + 按钮原语），视图只消费返回值。理由是
这三条规则漏掉任何一条都不会立刻报错，只会**在某个窗口宽度下**才显出「文字折行、
按钮变高」的形态（ISSUE #423），而散落在 N 个 `<button>` 上的 class 改一处漏
一片。可参考的落地：`src/components/ui/service-status-row.tsx` 与
`src/components/studio/workflow-editor/workflow-editor-topbar-config.ts`。

> 那一份落在 `ui/`（而不是某个屏的目录）是 ISSUE #1900 定的：ComfyUI 的状态行
> 随「启动 / 关闭与日志」搬去侧栏单独一页之后，它的消费者跨了两个屏 ——
> 留在任一侧都会让另一侧反向依赖某个屏的目录。

#### 3.8.1.0 尺寸类只对「非行内盒」生效 —— 尺寸不能外包给调用处的布局

`width` / `height` 对 **`display: inline`** 的盒子**不生效**。`<span>` 默认就是
`inline`，所以 `<span className="size-6 rounded-full border-2 border-t-violet-500
animate-spin" />` 画出来的不是圆，而是「上下两条 2px 边框叠在一个行内盒上」：
**约 4px 宽、20px 高的竖线**。用户看不出那是加载指示器，只读到一个来源不明的图案
（ISSUE #720 的第 1 条）。

这条之所以长期没被发现：该组件此前**唯一的落点都在 flex 容器里** —— flex 会把
子项的 display 计算值块化，尺寸照常生效。于是「尺寸能不能成立」悄悄依赖了调用处
的布局，而这个前提从没被写下来。

```tsx
// ❌ 尺寸挂在行内盒上：size-6 被完全忽略
<span className="size-6 rounded-full border-2" />

// ✅ 自带 inline-block（或调用处显式给 block / flex）
<span className="inline-block size-6 rounded-full border-2" />
```

**判据**：一个「靠尺寸表达形态」的基元（转圈、圆点、头像…）要么自带非行内的
`display`，要么在自己的 props / 文档里写清「调用处必须给 flex/block 容器」。
前者更稳 —— 后者只是把同一个坑挪给下一个人。

> 同族的坑还有一条在 **Tailwind 产序**上：基类里写**带变体**的尺寸上限
> （`sm:max-w-sm`）会被排在所有无变体 utility 之后，**调用处传什么都压不过
> 它**（同族打同族只能看产序，跨族才有确定结论）。触发过的事故见 §14.3 的 T8
> 与 §7.30。

#### 3.8.1.1 一排控件的宽度由调用处决定，不由基础件预设

**基础件里不要预设 `w-full`。** 宽度是**布局决定**，不是控件属性 —— 同一个
下拉在「独占一行的表单」里该铺满，在「并排的一排筛选控件」里该随内容宽。

但「调用处到底覆盖不覆盖得掉」**取决于件里怎么拼 `className`**，这一格必须先分清楚：
否则会把一条**取向**当成一条**物理定律**，下一步就会去「修」一个本来没坏的基础件。

| 件里的写法 | 调用处再写 `w-auto` / `w-56` 的结果 |
| --- | --- |
| 裸拼接 `` `… w-full … ${className}` `` | **不保证赢** —— 两条同族 utility 都在产物里，胜负由 Tailwind 的**输出顺序**决定，与调用处写了什么无关 |
| `cn(…, className)`（本库绝大多数基元） | **调用处必赢** —— 合并阶段就把前一条同族类删掉。实测 `cn("h-8 w-full min-w-0", "w-auto")` → `h-8 min-w-0 w-auto`（`w-full` 已被丢掉） |

症状很具体（前一类）：调用处写了 `w-auto`、也写了 `flex-nowrap`，但每个下拉仍然
**各自铺满整行**，看上去像「`flex-nowrap` 没生效」（ISSUE #716 的工作流库
页头就撞上了这一条）。

**取向不变**：新写基础件仍然不选边、要「铺满」走显式开关。已存在的预设只在满足
两条时保留 —— ① 件里用 `cn()` 合并（调用处改得动）；② 那个默认值本身就是该件**最常见形态**
的答案。符合这两条的实例是 `ui/input.tsx`：它带 `w-full min-w-0`，而单行输入框在
`flex gap-2` 里与一个 `shrink-0` 按钮并排时，「`w-full` + `min-w-0`」恰好就是「吃掉剩余宽度、
又不撑破兄弟」那一格。拆掉它不是修越界，而是**换默认值**：所有不传宽度的调用点会一起退成
浏览器给 `<input>` 的固有宽度（约 20 个字符），那是一次全站排版变更，得按排版变更来对待
（要读数、要复看），不该借「合规」的名义顺手做。判定记录在 `docs/DESIGN.md` §Components 的输入行。

```tsx
// ❌ 裸拼接里预设宽度：调用处的 w-auto 覆盖不掉（胜负看产序）
<span className={`flex w-full items-center … ${className}`} />

// ✅ 宽度是调用处的决定；需要「铺满」时走显式开关
<span className={`flex items-center … ${fullWidth ? "w-full" : "w-auto"} ${className}`} />
```

同理，**「占满剩下的宽度」与「铺满容器」是两件事**：前者要 `flex-1` 的
**外层**（外层才是 flex 项，宽度才由剩余空间给出），把 `flex-1` 写在控件自己
的 `className` 上不起作用 —— 控件自身仍是内容宽，旁边的兄弟一变长它就被挤回去。
可参考的落地：`src/components/ui/select-menu.tsx` 的 `fullWidth` 开关
（缺省随内容宽），以及 `StyleSwitcher` / `WidgetControl` 两处显式传值。

### 3.9 布局类名顺序约定（可读性）

```tsx
// ✅ 推荐顺序：定位 → 盒模型 → 排版 → 颜色 → 交互/状态 → 工具
className="
  absolute top-3 left-1/2 -translate-x-1/2 z-50  /* 定位 */
  flex items-center gap-0.5                        /* 盒模型/布局 */
  rounded-xl border border-white/10 bg-[#1a1a24]/90 /* 颜色 */
  px-1.5 py-1 shadow-lg backdrop-blur-md          /* 视觉 */
  hover:bg-white/[0.08] focus:outline-none         /* 交互 */
"
```

不强制工具化排序，但保持同类属性相邻，便于多人协作时 diff 可读。

---

### 3.10 屏级标题走字阶档，字号不在调用点写（机器强制）

标题的**数值只住在一处 `:root`**，调用点只挑档，不再叠尺寸：

> ⚠️ 从前这三颗住在 `@theme` 里，而 `@theme` 的 `--text-*` 命名空间会被 Tailwind
> **顺带生成成工具类**（实测产物里有 `.text-page` / `.text-section` / `.text-stage` 三条，
> JSX 侧零消费者）。留着它们等于留着两个坑：`cn()` 把不认识的 `text-<名字>` 归进**颜色**组、
> 吃掉同一行真正的状态色；而调用点写下的是「一个会随设置页变的字号」。移到 `:root` 之后
> 那个类不存在了，「别在 JSX 里用它们」从一句注释变成机器事实
> （定义侧 `tests/theme-token-single-source.test.ts` T6、调用侧
> `tests/design-md-contract-sync.test.ts` 各钉一条）。

| 档位            | token                        | 类名             | 用在哪                                                  |
| --------------- | ---------------------------- | ---------------- | ------------------------------------------------------- |
| 区块 / 卡片标题 | `--text-section`（0.875rem） | `.u-title`       | 面板与卡片的小标题                                      |
| **屏级标题**    | `--text-page`（1.5rem）      | `.u-title-page`  | **每屏唯一的 h1**                                       |
| 段级标题        | `--text-stage`（1.0625rem）  | `.u-title-stage` | 工坊六段当前段的标题（屏级与区块之间那一层）            |

**没有「例外档」这一行**（ISSUE #1691）：曾经还有一档 `--text-hero`（2.125rem）/
`.u-title-hero`，理由是「首页欢迎区那块大标题确实不是屏级标题那一档，但例外必须有名字」。
首页那块欢迎区（标题「灵感从这里开始」+ 副标题）后来整个删掉了 —— 它一个信息都不给，
却占掉首屏上沿约 150px —— 于是这一档零消费者，连同 `@theme` 里的声明与
`globals.css` 里的规则一起退役。**别为「以后可能用得上」留在库里**：留着的代价是
「唯一档」这句话在后一个想写 `text-[ 34px ]` 的人面前就不成立了（P83 现在只认
`.u-title-page` 一条 —— 从前它还认 `text-page`，那颗 token 移出 `@theme` 之后
那个类根本不再被生成，见上面那条 ⚠️）。

**为什么要立这条**：`.u-title-page` 在 `globals.css` 里早就注明是「页面级标题（h1）
统一规范」，可它引入至今**只有 1 处消费者**；屏级标题实际写在 11 个 `h1` 上，尺寸有
18 / 20 / 24 / 34px 四五种。同一个角色在不同屏大小不一，「改一下标题字号」就退化成
逐文件点名 —— 与 §3.6.2 治颜色前的问题是同一形态。

**判据**：`scripts/check-ui-primitives.cjs` 的 **P83**（棘轮，基线 0）—— 扫视图层
`<h1>` 的属性段，必须出现 `.u-title-page`（**唯一出口** —— `text-page` 那个同名类
已经随 token 移出 `@theme` 而不存在了，挂它的 h1 字号会退回继承），
且不得再叠 `text-lg` / `text-[ 34px ]` 这类硬写字号。属性段走平衡扫描
（`readJsxAttrsPastTag`），因为 `className={cn("u-title-page", a > b ? … : …)}` 与
`className={[…] .join(" ")}` 里都有 `>`，粗锚会在这两种形态上漏计（P82 的同一教训）。

**刻意不管的两处**，别把判据当成「越少档越好」：

- **h2 / h3 不入本条**。区块级标题保留 11–14px 的几档微排版（画布节点标签、
  日志小节、属性表列名各是一档），并成一档会**压平信息层次**；判据越界只会逼下一个人
  拆掉合理排版去迎合机器。工坊那一刀正好撞上这点：想把「所有 `h2` 都走段级档」写成判据时，
  第一条被抓出来的就是一枚本该走 `.u-title` 的卡片标题 —— 于是段级档 `.u-title-stage`
  （`--text-stage`，17px）只给「当前段标题」用，全屏结构约束由该屏自己的源码守卫
  `src/components/workshop/workshop-heading-structure.test.ts` 看住（全屏恰好一个 `h1`、
  段级档恰好一处用点、标题上不出现 `text-[ Npx ]`）。**要更严的约束就写成该屏的守卫，
  别把它升成全局规则。**
  ⚠️ **这一句从前写的是「10.5–14px」，那是登记错了射程**：量下来 52 处 10.5px 里只有
  **1 处**落在 `h3` 上，其余全是 `<p>` / `<span>` / `<div>` 的元信息行（正是 `text-2xs`
  登记的角色）—— 它不是「h2/h3 的例外档」，而是「比 2xs 小半像素」的漂移值，已整批并入
  `text-2xs` 并签成归零等式（方向、+0.5px 的逐处结构判与反向断言见契约 §Shapes ⑥）。
  **登记例外之前先量落点**，否则例外会变成第二条通路。
- **`ui/` 基元不自查**。第三方基元（`sidebar.tsx` 等）自带形态，走 `EXEMPT_DIRS`。

**新增一个屏时**：这一屏的标题层级必须是 `h1`（读屏按标题跳转），**可见与否看页签**——
屏名已经由常驻页签（或顶栏）给出时不再重复一次可见标题，走 `PageHeader` 的 `srTitle`
（屏名进 `sr-only`，那一行不占位，ISSUE #1693）；屏名只在这一屏才出现的，才给
`.u-title-page` 的可见 `h1`。副说明按「读几次」分两种挂法：**每次进屏都要读**的写
`description`（`.text-sm text-ink-muted` 那一行），**偶尔才需要读**的写 `help`
（收成悬浮「说明」按钮，句子进 tooltip 那一档）。要更大的字就先在 `@theme` 加**具名档**，
不要在调用点写 `text-[ … ]`。

**这两个类名不再手写**：上面那一组（`h1` + 副说明 + 右侧动作组）已收进
`~/components/ui/page-header` 的 `PageHeader`（规范 16 §16.2.4.73）——
标题从 `pageHeaderTitle(view)` 取，同一屏不出现第二个名字。文档屏直接用它；
工具条形态的页头（标题与工具栏同处一条横杆）留各自的实现，但那里的字阶档照旧。

#### 3.10.1 三档对照：屏级 14 / 段级 12 / 记号 11–10（ISSUE #1751）

标题之外，一屏里的**说明文字**只有三档，按「谁在读它、读几次」分，不按视觉喜好分：

| 角色                       | 档位            | 用在哪                                                                                  | 出口                                                                |
| -------------------------- | --------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| **屏级副说明**             | `text-sm`(14px) | 页头标题之下那一行「答案在别处拿不到的那句话」（时间口径 / 数据来源 / 能做什么）         | `ui/page-header` 的 `description`，**别手写这一行**                 |
| **屏级那句但不常驻**       | `text-xs`(12px)（`ui/tooltip` 那一档） | 同一句话，但**偶尔才需要读** —— 收成悬浮「说明」按钮，页眉不再占那一行（页签已在说屏名的那批屏，ISSUE #1693） | `ui/page-header` 的 `help`（屏名同时退 `srTitle`）。**与 `description` 二选一**，同传时 `description` 赢 |
| **段级说明（含同行 hint）** | `text-xs`(12px) | 区块小标题右侧那半句「这一区在配什么」、卡片里的整句中文解释、属性面板的说明段           | `ui/section-label` 的 `hint`；整句说明直接落 `text-xs`              |
| **记号**                   | `text-2xs`(11px) / `text-3xs`(10px) | 机器 id / 计数（`tabular-nums`）/ 胶囊标签 —— **不是给读的文案**，是给「代码 / 日志 / 配置里对得上」的标记 | 就地写（它随容器尺寸、不成篇）                                      |

两条判据的分工（**一条判形状、一条判档**，都在这份文档的射程内）：

- **P86**（`scripts/check-ui-primitives.cjs`，硬闸）：锚「`.u-title-page` 的标题」与
  「`mt-1 text-sm` 的副说明」在 8 行窗口内**同现** —— 判的是**形状**（有没有手搓页头）。
  它的软肋是**要 `text-sm` 才起跳**：把档写低反而绕过它。
- **屏级副说明档**（`tests/design-md-contract-sync.test.ts` 的**归零等式**）：锚
  「`.u-title-page` 后 4 行内的**第一个** `<p>`」不许低于 `text-sm`，**不看间距档** ——
  判的是**档**。两条合起来才盖住「手搓 + 写低」这一格；单靠任一条都有绕过口。

**为什么要立这条**：ISSUE #1751 的原话是「界面小字看不清」，量完的结论**不是字体、
也不是对比度**（`--color-ink-muted` 在深色四种底上是 6.24–7.15，早就过 AA 的 4.5），
而是**档写低了**：「模式契约」「模型适配」两屏自绘页头，屏级副说明吃了 `text-xs`(12px)，
而隔壁 9 个屏走 `ui/page-header`、同一角色是 `text-sm`(14px)。同一个角色两种大小。

**说明文字**（段级那 4 处整句中文解释）此前也漂在 11 / 10px 上。**记号那三档不许动**
——`font-mono` 的机器 id、`tabular-nums` 的计数、`bg-subtle rounded-* px-*` 的胶囊，
它们本来就是「小一档的标记」，并到 12px 只会把密集容器的行挤开。

**没收的剩余债**（别把本批读成已清完）：仓里还有 61 处 `<p>` 落在 11 / 10px 档
（成片属性面板、画布节点错误条、工坊各面板的空态与反馈行、设置页的说明段……）。
⚠️ **这个数字已经变大、且没重新点数**：10.5px 整批并入 `text-2xs`(11px) 之后，其中
至少 13 处 `<p>` 落进了这一档的口径（其余落点的元素不在同一行，逐行标签数不出来）。
要收这批债时**先重测**，别拿 61 当现成的分母。
**多数是刻意的**（密集容器的第二行、卡片内状态条），也混着该升没升的。这一批
**没有判据**（「段落低于 12px」这个形状不报红），要收得逐屏看形态定档 —— 而撤掉的只是
**页面级**像素基线（规范 11 §11.8）：「整页有没有变形」确实没有自动判据，但组件那一侧
仍然有 Storybook 工作台 + `getComputedStyle` 值断言那两层。**改字号档要拿它们量一次真读数**
（第 3、4 刀就是这么抓到文档写错配对行高的），别只交结构判。所以**不开那条宽判据**
（会误伤一片），把债登记在案。

---

## 3.11 源扫描面是显式的两棵根，默认拒绝（机器强制）

**Tailwind v4 不写 `source()` 时的默认行为是「从项目根自动发现源文件」，唯一的减法是「被 git
跟踪」。** 这条默认在本仓的代价是实测出来的：自动全扫的产物有 **2796 条选择器片段 / 382452 字节**，
而只认 `src` + `.storybook` 两棵根的产物是 **2558 条 / 349887 字节** —— **238 条规则没有任何调用点**，
出处分布在规范正文与它的生成物镜像、typedoc 的 HTML、`changelog.d/**` 的账本碎片、门禁与 codemod
脚本里的样本串、根 `CHANGELOG.md`、以及用例目录。反向也成立：**显式根的产物是自动全扫的子集**
（新根 − 旧根 = 0 条），所以这一步只做减法、不会凭空造出样式。

于是 `src/app/globals.css` 头部写成：

```css
@import "tailwindcss" source(none);
@source "../../src";
@source "../../.storybook";
```

路径**相对 CSS 文件所在目录**（`src/app`）解析 —— 写成 `docs` 会被解析成 `src/app/docs`，
表现不是报错而是**静默扫空**（`tests/tailwind-source-roots.test.ts` 的空跑挡板兜的就是这一格）。

**三件事必须一起知道：**

1. **`.storybook` 为什么是根而不是「顺手加的」**：`.storybook/preview.tsx` 引的就是同一份
   `globals.css`，而工作台外壳自己写了两枚任意值高度。实测「只认 `src`」与「认这两棵根」的
   产物差集**正好是这两条** —— 漏掉这棵不是省字节，是把工作台的取景高度调没。这条差集由
   判据第二格钉着：**摘掉任何一根必须真的丢样式，且丢的那些必须确实写在那一根的文本里**。
2. **默认拒绝的代价**：根外的类名字面量不再进产物。唯一能变成真故障的形态是
   **「运行期拼出来的类名，而完整字面量恰好只写在根外」** —— 它与 §3.6.2 末段那条
   「禁止拼 token 名」是同一族事故，只是这里拼的是类名。落这一刀时逐条查过三条通路，
   结论都写在 `globals.css` 的注释块里：根内「方括号里插值」0 处（唯一命中是一条说明这种
   写法从来没生效过的注释）；`src/**` 运行期 `import` 的 4 份 `scripts/**` 模块里 0 条
   Tailwind 类串；壳侧 HTML 是构建产物、不是扫描输入。
   **新增一棵根之前要重新走一遍这三条**，并在 `tests/tailwind-source-roots.test.ts` 的
   `SOURCE_ROOTS` 里写明它是谁 —— 名单多一棵、少一棵、登记了却不存在，三种都会红。
3. **判据自己的编译入口要跟着剥生产根**：`tests/helpers/theme-tokens.ts` 的两个入口
   （#1336 那份「固定输入源」与 `compiledCssPinnedTo`）都先走 `stripSourceDirectives`。
   不剥的话，钉成 `docs` 的那一遍会连 `src` 一起扫进来，差集判据就在对一个混合面下结论；
   而 theme 判据会顺带扫全 `src`，#1336 那笔「耗时 + 不可复现」的账以新形状回来。
   这一条不是推演：判据第三格拿 `.text-2xs` 当探针正面认它。

**与 §3.6.2 / 契约的分工**：本仓从前是靠「文档里别写全候选名」这条写作口径来防死规则的
（内侧留空格的写法、码 span 边界，见 `docs/DESIGN.md` 的扫描边界那条）。**默认拒绝把它从
「生产必须遵守」降级为「纵深防御」** —— 正文再写全一枚也不会进产物了。那条写作口径与它的
判据（`tests/docs-candidate-hygiene.test.ts`）**保留**，理由不是怀旧：它判的是「假如有人把根
放宽，代价是什么」，而放宽根恰恰是这条规格里最贵的那种动作。
