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

同类规范写法迁移还有四组（历史存量已由 `scripts/tw4-canonical-codemod.cjs` 清零，新代码禁止旧写法）：

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
```

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

**允许保留 `var(--color-…)` 的两类场景**（都在 `style={{}}` 里）：

1. **动态计算值**：值由运行时数据决定，Tailwind 静态提取不可能覆盖 ——
   连线 stroke、节点 accent 色、`boxShadow` 里的色相；
2. **需要非 Tailwind 属性承载**：React Flow 的 `maskColor`、`Handle` 的
   `borderColor` 这类组件 props。

这两类**也要给随主题的 token**，不要把「浅色观感」写死成兜底值：
`var(--color-ink, #EDEDF2)` 的兜底只在变量未定义时生效，看着像浅色安全，
实际永远取不到；真正需要两态时，就该像 `--color-port-surface` 那样
**新增一个 token 并两态赋值**，而不是挑一个「深色下大概能看」的兜底。

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

### 3.3 Tooltip 必须加 z-index

```tsx
// ❌ 错误：tooltip 可能被右侧内容覆盖
<span className="absolute left-full ml-2 ...">

// ✅ 正确
<span className="absolute left-full z-50 ml-2 ...">
```

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
// ✅ 动态 key：中央 Icon 组件（src/components/ui/Icon.tsx，内部已带 aria-hidden）
import { Icon } from "@/components/ui/icon";
<Icon name="plus" size={16} strokeWidth={2} />;
```

新增图标时先在 `Icon.tsx` 的 lucide import 与 `ICON_MAP` 各加一行再使用；静态图标直接 import lucide，动态/可序列化 key 一律走 `<Icon name>`。

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

| 表面                                                                                                                            | 应使用的 token                                                                                                                                                                                                                     |
| ------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ReactFlow 缩放/适配/锁定控件 `.react-flow__controls-button`                                                                     | `--color-node` / `--color-border-strong` / `--color-ink-muted`                                                                                                                                                                     |
| MiniMap 非视口遮罩（`maskColor`）                                                                                               | `--color-canvas-minimap-mask`                                                                                                                                                                                                      |
| 原生 `<select>` / `<option>` 与滚动条                                                                                           | `color-scheme` + `--color-node` / `--color-ink-field`                                                                                                                                                                              |
| 登录页整屏底 + 极光                                                                                                             | `--color-bg` + 两态极光                                                                                                                                                                                                            |
| 端口圆点描边 / 内圈高光（`border-(--color-canvas)` + 25% 白 `inset`）                                                           | `--color-port-surface`                                                                                                                                                                                                             |
| 端口内圈光晕（`flow-focus-endpoints` 的 `portDotGlow`）                                                                         | `--color-port-halo-ring` / `--color-port-halo-ring-weak`                                                                                                                                                                           |
| 项目画布 MiniMap / Background / Controls（`#0D0818` / `#0B0712` / 25% 白点阵）                                                  | `--color-canvas-minimap-mask` / `--color-canvas-grid-dot` + `.react-flow__controls*` token 规则                                                                                                                                    |
| 工作流画布底色 `CANVAS_BG`（写死 `#0a0a0f`）                                                                                    | `--color-canvas`                                                                                                                                                                                                                   |
| 画布标尺文字 / 连线中点圆点（85% 近白字 + 深色 text-shadow / 纯白点）                                                           | `--color-canvas-ruler-ink` `-shadow` / `--color-edge-hub-dot`                                                                                                                                                                      |
| 子图标题栏混色基准（写死 `#16161E` 作为 `mixHex` 基色）                                                                         | `--color-node-mix-base`                                                                                                                                                                                                            |
| `JsonViewer` 的 `react18-json-view` 主题（`dark` prop + `jv-theme-comfy` 暗色档）                                               | 两态 `--json-view-*` token（浅色默认 + `.dark` 覆盖）                                                                                                                                                                              |
| `CodeBlock` 的 shiki 主题（写死 `one-dark-pro`）                                                                                | 按 `resolvedTheme` 在 `one-dark-pro` / `github-light` 间切换                                                                                                                                                                       |
| `lib/comfyui/markdown.ts` 内联 style（便签 Markdown）                                                                           | `--color-md-*` token                                                                                                                                                                                                               |
| 类型 chip 的载体底（`WorkflowNodeArdot` 与 `WorkflowPortHandle` 的 `portChipStyle` 都曾写死 `#1E1A2E` / `#331A28` / `#26262E`） | `--color-chip-type-image-bg` / `--color-chip-type-video-bg`（中性档用 `--color-border-strong`）；chip **文字**仍是类型色，**底色**是表面。同一形态在本仓库犯过两次（先只改了 `WorkflowNodeArdot`），改一处要同时扫 `portChipStyle` |
| 项目画布浮层工具条底（`CanvasToolbar` 的 `to-[#16121f]/85`）                                                                    | `--color-panel/85` + `--color-shadow-strong`                                                                                                                                                                                       |
| 节点 JSON 浮层的 accent / chip 色（写死 `#7C5CFC`/`#5BC6FF`/`#ec4899` 等）                                                      | `--color-primary` / `--color-info` / `--color-accent-soft` / `--color-ink-faint` / `--color-success-strong` / `--color-warning`（带透明度用 `color-mix()`）                                                                        |
| 「本机 / 在线」状态点与文字（写死 `#33D499`）                                                                                   | `--color-status-online`（浅色 = `#047857`，与 `emerald-700` 同值）                                                                                                                                                                 |

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
`bg-[#16161E]` 的节点底、`rgba(255,255,255,0.18)` 的分隔点 —— **不属于**
本条，必须 token 化。判据一句话：**这行色值是「内容自己的颜色」还是「某个
表面的颜色」？** 前者可留，后者必改。

> **同一行里的文字色与底色要分开判**：类型 chip 是典型 —— chip 的**文字色**
> （`#7C5CFC` 等）是端口类型色，属本条可留；chip 的**载体底**（原先写死
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
pnpm theme:check    # 棘轮检查：未豁免的写死色值只许降不许升
```

- **为什么要有它**：豁免此前只写在规范与 `globals.css` 注释里，是人读的口径。
  扫描器没有机器可读的豁免清单，于是同一批类型色（端口类型色 / 节点类别色 /
  参数分组色）每轮扫描都被当漏网再报一遍，白耗一轮。
- **豁免必须显式**：清单逐条列出「文件 + 顶层标识符 + 理由」，不做「按目录 /
  按关键字通配」的模糊放行 —— 模糊放行会让真正的漏改混在豁免里悄悄溜过。
  成组常量表以外的落点（哪怕同样是类型色，如函数体内联）也**不要**顺手加豁免。
- **棘轮**：豁免之外仍有存量的写死色值，按「文件 → 处数」记在
  `scripts/.theme-color-baseline.json`，新写的写死色值一律阻断；逐批治理后用
  `node scripts/check-theme-colors.cjs --update` 收紧基线（同 UI/逻辑分离棘轮
  的口径，见 17 章）。已接入 `.githooks/pre-commit` 与 CI。

### 3.6.2 品牌/状态色必须走语义 token（ISSUE #672，机器强制）

「改一处样式、全站生效」的前提是**颜色有单一事实来源**。实测出的反例：
`--color-primary: #7c5cfc` 定义得好好的，但 `ui/confirm-dialog.tsx` 写死
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

**本项目已有的语义色 token**（新增前先查这张表，别再写死字面量）：

| 语义       | token / 类名                                   | 用途                                                        |
| ---------- | ---------------------------------------------- | ----------------------------------------------------------- |
| 品牌主色   | `--color-primary` → `primary`                  | 浅色底下当**底**用（`bg-primary/15`）                       |
| 品牌文字档 | `--color-primary-strong` → `primary-strong`    | 浅底上的品牌**文字/图标**（原 `violet-700` / `violet-400`） |
| 品牌实心档 | `--color-primary-500` / `--color-primary-600`  | 实心按钮底、spinner 描边（原 `violet-500` / `violet-600`）  |
| 品牌浅底   | `--color-primary-soft`                         | 图标托底、选中项底                                          |
| 强调/品红  | `--color-accent` / `--color-accent-soft`       | 第二品牌色                                                  |
| 成功       | `--color-success` / `--color-success-strong`   | 状态绿（原 `emerald-*`）                                    |
| 警告       | `--color-warning` / `--color-warning-strong`   | 待处理/排队（原 `amber-*`）                                 |
| 危险       | `--destructive` / `--color-danger-strong`      | 失败/删除（原 `red-*`）                                     |
| 信息       | `--color-info` / `--color-info-strong`         | 链接/提示（原 `cyan-*` / `blue-*`）                         |
| 极光晕     | `--color-aurora-violet` / `-cyan` / `-magenta` | 装饰性背景光晕的**色相**（强度由调用处决定）                |

**「同一个原色在两个位置上取不同值」是正常的，别用同一份写死值糊过去**：
品牌紫 `#7c5cfc` 当底色可以、当浅底上的文字色对比度不够 —— 所以有
`--color-primary`（底）与 `--color-primary-strong`（字）两颗 token。
这正是不该写死的原因：写死的那一处无法表达这个区分。状态色同理：
`warning` / `success` / `info` / `danger` 各自都有「当底的原色」与
「浅底上当字的 `*-strong` 档」。

**这套区分直接决定 `Button` 的语义变体怎么写**（16 §16.2.4.1）：
`variant="warning"` 的底色取 `bg-warning/10`、文字取 `text-warning-strong`，
而不是两边都用 `amber-500`。

**装饰性渐变/光晕**：色相进 token，**强度（alpha）留在调用处**。同一个极光晕
曾在登录页 / 首页 / `FilmStudio` / `TrainingStudio` 各抄一份、且值不同
（0.48 / 0.42 / 0.40），现在统一走 `AuroraGlow`（`tone` 选色相、`alpha` 定强度）——
与 §3.5 的「AuroraBackground 模式」是同一条要求：**同一个装饰不在多处内联重复**。

**机器判定**：`scripts/check-theme-colors.cjs`（`pnpm theme:check`，pre-commit
第 13 步）。它认「写死的 `#rrggbb` / `rgba(...)`」，而 Tailwind 类名形式的
语义色类名本来就扫不到 —— 也就是说**本节的判据靠「不要在源码里写字面量」实现**：
只要颜色是类名，`theme:check` 与改名/换 token 都不会有冲突。
`EXEMPT_TABLES` / `EXEMPT_FIXED_DARK` 的豁免口径与 §3.6.1 完全一致。

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
> （如 `min-w-[170px]`）。带 `truncate` 的标题其 min-content 只有一两个字符宽，
> 没有下限时 flex 会认为它「还能再压」，按钮组永远等不到换行、只能被压到与
> 标题重叠；下限给太大（相对按钮组天然宽度）则会在明明排得下的时候过早换行。

**同构的成排按钮抽一份判据**：同一个页面里形态相同的按钮排（典型是设置页的
「状态行」：左侧状态文字 + 右侧一排动作按钮，ComfyUI / Drizzle Studio /
Ollama 三处同构）不要再各自拼 class——抽成一个纯派生模块（常量 + 拼串函数，
规范 17 §17.2 第①层），视图只消费返回值。理由是这三条规则漏掉任何一条都不会
立刻报错，只会**在某个窗口宽度下**才显出「文字折行、按钮变高」的形态（ISSUE
#423），而散落在 N 个 `<button>` 上的 class 改一处漏一片。可参考的落地：
`src/app/(main)/settings/settings-status-row-config.ts` 与
`src/components/studio/workflow-editor/workflow-editor-topbar-config.ts`。

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
