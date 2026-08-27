## 3. 样式与 Tailwind

> 本项目使用 Tailwind CSS v4（`@theme` 配置）+ 少量 CSS 变量。样式规则的目标是：一致性、可维护性、暗色模式可切换。

### 3.1 Tailwind v4 透明度写法

```tsx
// ❌ 错误：/6 不是 Tailwind 预设值，会被忽略
"hover:bg-white/6"

// ✅ 正确：用方括号任意值
"hover:bg-white/[0.06]"

// ✅ 或者用最接近的预设
"hover:bg-white/5"
```

**Tailwind v4 预设透明度比例**：`/0 /5 /10 /15 /20 /25 /30 /35 /40 /45 /50 /55 /60 /65 /70 /75 /80 /85 /90 /95 /100`。只有这些可以直接写，`/6`、`/8` 等必须用 `/[0.06]` 形式。

### 3.2 避免魔法字符串：提取到主题/Design Token

```tsx
// ❌ 错误：魔法透明度值散落各处
"bg-white/[0.04] hover:bg-white/[0.08] border-white/[0.06]"

// ✅ 方案 A：tailwind.config / @theme 扩展语义色
// @theme { --color-surface-1: rgba(255,255,255,0.04); }

// ✅ 方案 B：用 cva 管理变体（推荐用于复用按钮/面板）
import { cva } from "class-variance-authority";
const panelVariants = cva(
  "rounded-2xl border transition-colors",
  {
    variants: {
      tone: {
        default: "bg-white/[0.02] border-white/[0.06]",
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
