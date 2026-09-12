## 3. 样式与 Tailwind

> 本项目使用 Tailwind CSS v4（`@theme` 配置）+ 少量 CSS 变量。样式规则的目标是：一致性、可维护性、暗色模式可切换。

### 3.1 Tailwind v4 规范类名写法

v4 支持任意透明度百分比直接写在斜杠后；方括号 alpha 是 v3 遗留写法，编辑器（suggestCanonicalClasses）会持续提示改写：

```tsx
// ❌ 旧写法：方括号 alpha 值
"hover:bg-white/[0.06]"

// ✅ 正确：任意百分比直接写（v4 canonical，编译为 color-mix 6%）
"hover:bg-white/6"
```

同类规范写法迁移还有四组（历史存量已由 `scripts/tw4-canonical-codemod.cjs` 清零，新代码禁止旧写法）：

```tsx
// 渐变更名：
"bg-linear-to-br"               // ✅ v4
"bg-gradient-to-br"             // ❌ v3 旧名

// CSS 变量任意值有专用简写：
"w-(--panel-right-width)"       // ✅ v4
"w-[var(--panel-right-width)]"  // ❌ v3 写法

// 负值：负号移入括号内（前缀负号是 v3 形式）：
"top-[-20%]"                    // ✅ v4
"-top-[20%]"                    // ❌ v3 写法

// 纯整数任意值用裸数字（z / order / duration 等数值工具类同理）：
"z-99"                          // ✅ v4
"z-[99]"                        // ❌ 多余括号
```

**规则**：透明度一律 `/百分比`（小数合法，如 `/1.5`——tailwindcss 内部正是以 `parseFloat(alpha)*100` 做规范化的）。

### 3.2 避免魔法字符串：提取到主题/Design Token

```tsx
// ❌ 错误：魔法透明度值散落各处
"bg-white/4 hover:bg-white/8 border-white/6"

// ✅ 方案 A：@theme 扩展语义色（Tailwind v4 用 CSS 配置，见 src/app/globals.css）
// @theme { --color-surface-1: rgba(255,255,255,0.04); }
// 组件里用 bg-surface-1 引用，禁止直接写 bg-white/4 散落各处

// ✅ 方案 B：用 cva 管理变体（推荐用于复用按钮/面板）
import { cva } from "class-variance-authority";
const panelVariants = cva(
  "rounded-2xl border transition-colors",
  {
    variants: {
      tone: {
        default: "bg-white/2 border-white/6",
        active:  "bg-violet-500/10 border-violet-500/30",
      },
    },
    defaultVariants: { tone: "default" },
  }
);
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
<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
  <path d="..." />
</svg>

// ✅ 正确：统一图标库（tree-shakeable、风格一致）
import { Home, Zap, FolderOpen, Search, X } from "lucide-react";
<Home size={20} strokeWidth={1.8} />
```

**数据驱动的图标名**（API 返回字符串 key、配置项/数据模型选图标）走中央解析组件，不直接 import：

```tsx
// ✅ 动态 key：中央 Icon 组件（src/components/ui/Icon.tsx，内部已带 aria-hidden）
import { Icon } from "@/components/ui/icon";
<Icon name="plus" size={16} strokeWidth={2} />
```

新增图标时先在 `Icon.tsx` 的 lucide import 与 `ICON_MAP` 各加一行再使用；静态图标直接 import lucide，动态/可序列化 key 一律走 `<Icon name>`。

**例外**：项目品牌图标、复杂插画、需要精细控制的装饰性 SVG（如 Aurora 极光晕）可保留内联 SVG/组件。

### 3.5 CSS 注入用静态文件，不用 JS 动态注入

```tsx
// ❌ 可接受但不推荐：模块级变量防重复注入，代码分割后可能失效
let INJECTED = false;
if (!INJECTED) { document.head.appendChild(style); }

// ✅ 正确：放到 globals.css 或独立 .css 文件 import
import "@/styles/json-viewer.css";
```

**AuroraBackground 模式**：极光装饰光晕作为可复用装饰组件集中管理（`AuroraBackground.tsx`），不要在多个页面内联重复相同的 radial-gradient 块。

### 3.6 暗色模式与 CSS 变量

```css
/* ✅ 语义化 token，暗/亮模式切换只改 token 值 */
:root {
  --color-surface-0: #0a0a0f;
  --color-surface-1: rgba(255,255,255,0.02);
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

**准入判据（两条都满足才可进清单）**：

1. 该表面是「**内容视图内的极小面积叠层**」——浮在画布/预览/媒体之上的一
   小块说明或装饰，不是页面、面板、控件这类结构性表面；
2. 换成浅色会破坏其**承载对象**的可读性——典型是叠在图片/视频预览上的
   文字，浅底会与内容糊在一起。

两条有一条不满足，就必须走 token，**不得**进清单。

**已明确不属于固定暗色**（历史误判，已 token 化，勿回退）：

| 表面 | 应使用的 token |
|---|---|
| ReactFlow 缩放/适配/锁定控件 `.react-flow__controls-button` | `--color-node` / `--color-border-strong` / `--color-ink-muted` |
| MiniMap 非视口遮罩（`maskColor`） | `--color-canvas-minimap-mask` |
| 原生 `<select>` / `<option>` 与滚动条 | `color-scheme` + `--color-node` / `--color-ink-field` |

> 判据的用意：**控件**是结构性表面（用户要操作它），跟主题走才不会在浅色
> 下变成「深底深图标」的隐形按钮；**叠加在内容上的说明层**才是例外。

**维护**：

- 增删条目时，`globals.css` 注释块与本表同步改，并在 PR 描述里写明理由；
- 审查/提交前自查：新增的 `#rrggbb` 或 `rgba(255,255,255,*)` 是否属于清单
  条目？不是就换 token。

### 3.7 装饰性元素可访问性与性能

```tsx
// ✅ 装饰背景/光晕：pointer-events-none + aria-hidden
<div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
  <div className="absolute ... rounded-full mix-blend-screen" style={{ background: "radial-gradient(...)" }} />
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
