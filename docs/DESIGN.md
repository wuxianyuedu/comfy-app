---
version: alpha
name: Comfy-APP-T3
description: 桌面端创作工具的设计契约。从 `src/app/globals.css` 的 Tailwind v4 主题、`src/components/ui` 的 83 个基元与 `docs/standards` 的样式/a11y/组件规范反推而来；每一态的取值由 CSS token 负责，本文件记录的是「名字该是谁、值随谁变」。
colors:
  primary: "#7c5cfc"
  on-primary: "#ffffff"
  primary-strong: "#6d28d9"
  primary-solid: "#8b5cf6"
  primary-soft: "#f1ecff"
  accent: "#ff5ca8"
  accent-deep: "#c026d3"
  ink: "#1a1a1f"
  ink-muted: "#6b6b76"
  ink-fainter: "#a1a1aa"
  canvas: "#ffffff"
  surface-card: "#ffffff"
  surface-subtle: "#f7f8fa"
  chip-image-surface: "#f2eeff"
  chip-video-surface: "#fff0f6"
  hairline: "#ececf1"
  hairline-strong: "#d6d8dd"
  danger: "#b91c1c"
  danger-solid: "#e7000b"
  success: "#0ea472"
  success-strong: "#10b981"
  warning: "#d97706"
  warning-strong: "#b45309"
  info: "#2563eb"
typography:
  hero-lg:
    fontFamily: "Geist, PingFang SC, Microsoft YaHei, Noto Sans SC, system-ui, sans-serif"
    fontSize: 34px
    fontWeight: 700
    lineHeight: 1.5
    letterSpacing: -0.025em
  heading-page:
    fontFamily: "Geist, PingFang SC, Microsoft YaHei, Noto Sans SC, system-ui, sans-serif"
    fontSize: 24px
    fontWeight: 700
    lineHeight: 1.5
    letterSpacing: -0.02em
  heading-stage:
    fontFamily: "Geist, PingFang SC, Microsoft YaHei, Noto Sans SC, system-ui, sans-serif"
    fontSize: 17px
    fontWeight: 600
    lineHeight: 1.5
    letterSpacing: -0.015em
  heading-section:
    fontFamily: "Geist, PingFang SC, Microsoft YaHei, Noto Sans SC, system-ui, sans-serif"
    fontSize: 14px
    fontWeight: 600
    lineHeight: 1.5
    letterSpacing: -0.01em
  body-md:
    fontFamily: "Geist, PingFang SC, Microsoft YaHei, Noto Sans SC, system-ui, sans-serif"
    fontSize: 14px
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: 0px
  body-sm:
    fontFamily: "Geist, PingFang SC, Microsoft YaHei, Noto Sans SC, system-ui, sans-serif"
    fontSize: 12px
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: 0px
  button-md:
    fontFamily: "Geist, PingFang SC, Microsoft YaHei, Noto Sans SC, system-ui, sans-serif"
    fontSize: 14px
    fontWeight: 500
    lineHeight: 1.25
    letterSpacing: 0px
  button-sm:
    fontFamily: "Geist, PingFang SC, Microsoft YaHei, Noto Sans SC, system-ui, sans-serif"
    fontSize: 12.8px
    fontWeight: 500
    lineHeight: 1.25
    letterSpacing: 0px
  code-md:
    fontFamily: "'SF Mono', ui-monospace, SFMono-Regular, Menlo, 'Cascadia Mono', Consolas, monospace"
    fontSize: 11.5px
    fontWeight: 400
    lineHeight: 1.65
    letterSpacing: 0px
  code-json:
    fontFamily: "'SF Mono', ui-monospace, SFMono-Regular, Menlo, 'Cascadia Mono', Consolas, monospace"
    fontSize: 11px
    fontWeight: 400
    lineHeight: 1.6
    letterSpacing: 0px
rounded:
  none: 0px
  xs: 2px
  sm: 7.2px
  md: 9.6px
  lg: 12px
  xl: 16.8px
  2xl: 21.6px
  3xl: 26.4px
  full: 9999px
spacing:
  xxs: 4px
  xs: 8px
  sm: 10px
  md: 12px
  lg: 16px
  xl: 24px
  xxl: 32px
  title-bar: 36px
  stage-rail: 208px
  panel-right: 360px
components:
  button-default:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    typography: "{typography.button-md}"
    rounded: "{rounded.lg}"
    height: 32px
    padding: "0px 10px"
  button-default-hover:
    backgroundColor: "rgba(124, 92, 252, 0.8)"
    textColor: "{colors.on-primary}"
    typography: "{typography.button-md}"
    rounded: "{rounded.lg}"
    height: 32px
  button-primary-solid:
    backgroundColor: "{colors.primary-solid}"
    textColor: "{colors.on-primary}"
    typography: "{typography.button-md}"
    rounded: "{rounded.lg}"
    height: 32px
    padding: "0px 10px"
  button-primary-solid-hover:
    backgroundColor: "#7c3aed"
    textColor: "{colors.on-primary}"
    rounded: "{rounded.lg}"
    height: 32px
  button-primary-soft:
    backgroundColor: "rgba(139, 92, 246, 0.15)"
    textColor: "{colors.primary-strong}"
    typography: "{typography.button-md}"
    rounded: "{rounded.lg}"
    height: 32px
    padding: "0px 10px"
  button-danger-soft:
    backgroundColor: "rgba(231, 0, 11, 0.1)"
    textColor: "{colors.danger}"
    typography: "{typography.button-md}"
    rounded: "{rounded.lg}"
    height: 32px
  button-danger-solid:
    backgroundColor: "{colors.danger-solid}"
    textColor: "{colors.on-primary}"
    typography: "{typography.button-md}"
    rounded: "{rounded.lg}"
    height: 32px
  button-warning-solid:
    backgroundColor: "{colors.warning-strong}"
    textColor: "{colors.on-primary}"
    typography: "{typography.button-md}"
    rounded: "{rounded.lg}"
    height: 32px
  button-gradient:
    textColor: "{colors.on-primary}"
    typography: "{typography.button-md}"
    rounded: "{rounded.lg}"
    height: 32px
  button-outline:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    typography: "{typography.button-md}"
    rounded: "{rounded.lg}"
    height: 32px
    padding: "0px 10px"
  button-ghost:
    backgroundColor: "rgba(0, 0, 0, 0)"
    textColor: "{colors.ink}"
    typography: "{typography.button-md}"
    rounded: "{rounded.lg}"
    height: 32px
  button-disabled:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    typography: "{typography.button-md}"
    rounded: "{rounded.lg}"
    height: 32px
  text-input:
    backgroundColor: "rgba(0, 0, 0, 0)"
    textColor: "{colors.ink}"
    typography: "{typography.body-md}"
    rounded: "{rounded.lg}"
    padding: "4px 10px"
    height: 32px
  text-input-focused:
    backgroundColor: "rgba(0, 0, 0, 0)"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    height: 32px
  select-trigger:
    backgroundColor: "rgba(0, 0, 0, 0)"
    textColor: "{colors.ink}"
    typography: "{typography.body-md}"
    rounded: "{rounded.lg}"
    height: 32px
    padding: "8px 8px 8px 10px"
  card:
    backgroundColor: "{colors.surface-card}"
    textColor: "{colors.ink}"
    typography: "{typography.body-md}"
    rounded: "{rounded.xl}"
    padding: "16px"
  card-sm:
    backgroundColor: "{colors.surface-card}"
    textColor: "{colors.ink}"
    rounded: "{rounded.xl}"
    padding: "12px"
  chip:
    backgroundColor: "{colors.surface-card}"
    textColor: "{colors.ink-muted}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.full}"
  chip-type-image:
    backgroundColor: "{colors.chip-image-surface}"
    rounded: "{rounded.full}"
  chip-type-video:
    backgroundColor: "{colors.chip-video-surface}"
    rounded: "{rounded.full}"
  nav-item-hover:
    backgroundColor: "#dfe3ec"
    textColor: "{colors.ink}"
    typography: "{typography.body-md}"
  nav-item-selected:
    backgroundColor: "#c6ccdd"
    textColor: "{colors.ink}"
    typography: "{typography.body-md}"
  surface-canvas:
    backgroundColor: "#f6f7f9"
  surface-panel:
    backgroundColor: "#ffffff"
  surface-panel-deep:
    backgroundColor: "#f0f1f5"
  surface-node:
    backgroundColor: "#ffffff"
---

# Comfy-APP-T3 设计契约

> **这份文件是什么**：把散在 `globals.css`、83 个 `ui/` 基元和 `docs/standards/03·04·06·16` 里的设计决定，收成一份「机器可读 + 人可读」的单一契约。它是 `design-qa` / `design-debt-review` / `accessibility-review` / `component-library-alignment` 这几道评审的基准——没有它，那些评审只能拿「代码自己等于自己」当标准，评不出漂移。
>
> **它不是什么**：它**不是** token 的权威源。颜色的权威源是 `src/app/globals.css` 的 `@theme`（规范 03 §3.6.4）。本文件引用 token 名、复述取值，但任何一方改了值，**以 CSS 为准**，本文件跟着改。
>
> **取证时间**：2026-10-03，`master` = `648a898e`。frontmatter 里的每个数字都经实测得到（测量方法见文末「取证方法」），不是从命名推的。

---

## Overview

这是一个 **Tauri 桌面壳里的 WebView2 生产力工具**，不是营销站。三条决定全部观感的底色：

1. **默认主题是 Dark**（`src/app/ThemeProvider.tsx:29`，`defaultTheme="dark"`、`enableSystem={false}`）。⚠️ 这一点和 CSS 的物理布局**是反的**：`@theme` 块里写的是**浅色档**字面量，`.dark` 块（`globals.css:272-362`）覆盖 72 颗——所以「读 `@theme` 就知道应用长什么样」是错的，读出来的那套是**用户默认看不到的那一态**。
2. **沉浸式编辑器是主界面**：画布、节点、连线、面板占据了大部分像素，页面级留白远小于普通 Web 应用；`--spacing` 默认刻度（4px）之上的每一档都被高频使用。
3. **两态取值是设计的一部分，不是适配项**：同一个色相当底色和当浅底上的文字**必须取两个值**（`--color-primary` vs `--color-primary-strong`）。这是本仓库最容易犯错的地方，也是 §3.6.1/§3.6.2 一整套固定暗色清单与机器判据存在的原因。

**基元库是 Base UI，不是 Radix。** `components.json` 声明 `style: "base-nova"`，实测 `src/` 内 `@radix-ui` 命中 0 处、35 个 `ui/` 文件 import `@base-ui/react/*`。`sheet.tsx` / `segment-popover.tsx` 里的 Radix 字样是历史迁移注释，不是依赖。

**没有 `tailwind.config.*` 文件**（Tailwind v4 CSS-first）。任何人想找「主题在哪改」，答案是且仅是 `src/app/globals.css`。

---

## Colors

### 三条体系的单向关系（先记方向，再记值）

| 体系 | 名字形态 | 角色 | 谁写它 |
| --- | --- | --- | --- |
| **项目 token** | `--color-*`（`@theme`，88 条声明） | **唯一事实来源**，浅/深两态各自赋值 | 产品代码 |
| **工具类桥** | `@theme inline` 的 `--color-*: var(--别名)`（28 条） | 让 `bg-card` 这类 shadcn 类名编得出来，**只是入口** | 不手写 |
| **shadcn 别名** | `--card` / `--border` / `--muted` …（`:root`，47 条） | 只做 `var()` 转发，**不写字面量**（除 `--chart-*` 与 `--radius`） | `ui/` 基元 |

三条硬判据由 `tests/theme-token-single-source.test.ts` 守着：**T1 别名不写字面量 / T2 `@theme inline` 不重名 / T3 var() 链无环**。

> ⚠️ **T2 只匹配 `--color-*`**，圆角刻度不在覆盖面内——见「Conflicts」第一条，那是本文件实测出的一个真实缺口。

### 语义角色表（浅色值取自 `@theme`，深色值取自 `.dark`）

| 角色 | token | 浅色 | 深色 | 用在哪 |
| --- | --- | --- | --- | --- |
| 品牌主色（当**底**） | `--color-primary` | `#7c5cfc` | 同值 | `bg-primary/15`、焦点环、`.btn-gradient` 起点 |
| 品牌文字/图标档 | `--color-primary-strong` | `#6d28d9` | `#a78bfa` | 浅底上的品牌紫字（原 `violet-700/400`） |
| 品牌实心档 | `--color-primary-500` / `-600` | `#8b5cf6` / `#7c3aed` | 同值 | 实心 CTA、spinner 描边 |
| 品牌浅底 | `--color-primary-soft` | `#f1ecff` | `#221c3a` | 图标托底、选中项底；**也是深底上的浅字档** |
| 第二品牌 / 品红 | `--color-accent` / `--color-accent-soft` | `#ff5ca8` / `#ec4899` | 同值 / `#ff8ac4` | 指示条渐变终点、CTA 渐变终点 |
| 品牌渐变中间档 | `--color-accent-deep` | `#c026d3` | 同值（刻意） | `.btn-gradient` 的 50% 那一段（起点 `--color-primary-600`、终点 `--color-accent-soft`，两端不另设 token） |
| 品牌实心底上的字 | `--color-on-brand` | `#ffffff` | 同值 | **它由「底」决定，不是独立美术选择** |
| 正文/前景 | `--color-ink` | `#1a1a1f` | `#ededf2` | `html/body` 前景 |
| 弱文字 | `--color-ink-muted` | `#6b6b76` | `#9a9aad` | 副说明、`.u-chip` 常态字 |
| 极弱文字 / 辅助说明 | `--color-ink-fainter` / `-faintest` | `#a1a1aa` / `#b6b6bf` | `#6b7088` / `#5a5f73` | 行号、placeholder、标签 |
| 页面底 | `--color-bg` | `#ffffff` | `#0a0a0f` | `html, body` 背景 |
| 卡片/浮层表面 | `--color-surface` / `--color-card` | `#ffffff` | `#16161c` | `bg-card`、`.u-card` |
| 极浅通用表面 | `--color-subtle` | `#f7f8fa` | `#141419` | hover 底、`bg-subtle` 类名调用点（⚠️ `.u-input` / `.u-avatar` 虽然 CSS 里引用它，但那批 `.u-*` 类**全仓零消费者**，见 Known Gaps） |
| 发丝边框 | `--color-border` | `#ececf1` | `#26262e` | 默认描边、`--input` 同源 |
| 强边框/分隔 | `--color-border-strong` | `#d6d8dd` | `#26262e` | 控件描边、滚动条 thumb |
| 画布底（编辑器） | `--color-canvas` | `#f6f7f9` | `#0a0a0f` | 工作流/项目画布 |
| 深面板底 | `--color-canvas-deep` | `#eef0f4` | `#0f0f14` | 输入控件、深面板 |
| 面板 / 侧栏底 | `--color-panel` / `--color-panel-deep` | `#ffffff` / `#f0f1f5` | `#14141a` / `#0f0f16` | 顶栏、浮层、侧栏/页脚 |
| 节点表面 | `--color-node` | `#ffffff` | `#2b2b36` | 画布节点、`<option>` |
| 危险（当底） | `--color-destructive` | `oklch(0.577 0.245 27.325)` ⇒ `#e7000b` | `oklch(0.704 0.191 22.216)` ⇒ `#ff6467` | `bg-destructive`、实心危险按钮 |
| 危险（浅底上的字） | `--color-danger-strong` | `#b91c1c` | `#fca5a5` | `text-danger-strong` |
| 成功 | `--color-success` / `--color-success-strong` | `#0ea472` / `#10b981` | `#5be3c4` / `#10b981` | 状态绿 |
| 警告 | `--color-warning` / `--color-warning-strong` | `#d97706` / `#b45309` | `#f59e0b` / `#fbbf24` | 待处理/排队 |
| 信息 | `--color-info` / `--color-info-strong` | `#2563eb` / `#1d4ed8` | `#5bc6ff` / `#7dd3fc` | 链接/提示 |
| 在线状态 | `--color-status-online` | `#047857` | `#33d499` | 「本机/在线」点与字 |

### frontmatter 的色值是**压平**后的，压平规则要一起读

frontmatter 的 `colors` / `components` 必须是可解析的色值，而实现里有两类东西压不进那个形状：

- **`oklch()` 落 sRGB**：`--color-destructive` 两颗都**超出 sRGB 色域**，浏览器会先做 gamut fit（降 chroma）再画。上表的 hex 是用 canvas 读回来的**实际字节**（浅色 `rgb(231,0,11)`、深色 `rgb(255,100,103)`），不是手写 OKLab 矩阵裁剪的结果——后者给的是 `#e7000b` 但**过程是错的**（朴素裁剪恰好撞近同一个值属于巧合，不可复用到别的色相）。**任何人改这颗色都要用同一个办法重取。**
- **透明度 `/N`**：`bg-primary-500/15` 编译成 `color-mix(in oklab, …)`，frontmatter 里写成等价的 `rgba(139, 92, 246, 0.15)`。混色空间（oklab vs sRGB）会让实际观感有细微差，**以 CSS 为准**。
- **正文一律用 CSS token 名（`--color-*`），不用 `{colors.*}` 引用**。DESIGN.md 的惯例是让散文用 `{colors.primary}` 这类引用把内容接回 frontmatter，但本仓库的 frontmatter 名是**角色**（`hairline`）、CSS 名是**事实来源**（`--color-border`），两套名字不同；写引用会把读者的注意力从「去哪儿改」引开。⇒ **frontmatter 是给工具看的压平视图，正文是给改代码的人看的指针**，两边都以 `globals.css` 收口。

### 「一个色相，两个位置，两个值」是本库的核心语法

`--color-X` 与 `--color-X-strong` **不是重复，是必需的**：品牌紫 `#7c5cfc` 当底色可以，当浅底上的文字色对比度不足。同理 `warning` / `success` / `info` / `danger` 各有「当底的原色」与「浅底上当字的 `*-strong`」。

再加一条更细的：**「浅底上的字」与「深底上的字」也是两颗 token**。影片时间轴片段底是深色渐变，上面的浅琥珀字用 `--color-warning-soft`（两态同值）；浅底上的琥珀字用 `--color-warning-strong`（深色下落亮）。两者在深色下取值接近、在浅色下**相反**——**借错了不报错，只是浅色下看不清**。

### 固定暗色清单与类型色例外（判据在 `globals.css:364-488`，规范 03 §3.6.1）

本应用**没有任何界面是「暗色品牌页」**。登录页、错误页、404、状态栏、日志面板全部走 token。只有两类例外，且都是**机器可读**的（`scripts/check-theme-colors.cjs` 的 `EXEMPT_FIXED_DARK` / `EXEMPT_TABLES`）：

- **固定暗色**（当前仅 2 条）：画布底部操作提示气泡 `bg-black/60`、子工作流加载遮罩 `bg-black/20`。准入判据两条都要满足——① 内容视图内的**极小面积叠层**（不是页面/面板/控件）；② 换浅色会破坏**其承载对象**的可读性。**整屏或结构性表面一律不进清单**，哪怕暗色更好看。
  > 底色固定时，配它的文字**也必须同为一态**（不能再用随主题的 `--color-ink-soft`，否则浅色主题下是「深底深字」）。
- **类型色例外**：端口类型色 / 节点类别色 / 连线状态色（`lib/comfyui/types.ts`、`CanvasNodePrimitives.tsx` 的 `PORT_STYLE`、`workflow-library-wire-graph.ts` 的 `MANUAL_STROKE` 等，约 320 处，**成组集中的常量表**）。它们画的是**内容自己**，不是承载内容的表面。
  > 一句话判据：**这行色值是「内容自己的颜色」还是「某个表面的颜色」？** 前者可留，后者必改。同一行里要**逐层判**——类型 chip 的**文字**是类型色（可留），chip 的**载体底**是表面（必须 token 化成 `--color-chip-type-image-bg` / `-video-bg`）。

---

## Typography

**Latin 走 `next/font` 加载的 Geist，CJK 靠系统字体回退**（`src/app/layout.tsx:25-28` 只声明了 `--font-geist-sans`）。

| token | 栈 | 备注 |
| --- | --- | --- |
| `--font-sans` | `var(--font-geist-sans)` → PingFang SC → Microsoft YaHei → Noto Sans SC → system-ui | `body` 挂 `font-sans antialiased` |
| `--font-mono` | SF Mono → ui-monospace → SFMono-Regular → Menlo → Cascadia Mono → Consolas | 原先各处内联 `fontFamily`，已收口到此 |
| `--font-title` | **Sarasa Gothic SC** → geist → PingFang → YaHei → system-ui | 见 Known Gaps：首选项未随包分发 |

### 字阶只有四档具名，数值住在 `@theme`（规范 03 §3.10，机器强制 P83）

| 档 | token | 值 | 类名 | 用在哪 |
| --- | --- | --- | --- | --- |
| hero | `--text-hero` | 2.125rem (34px) / 700 / -0.025em | `.u-title-hero` | 首页欢迎区那一个 h1——**屏级档的唯一例外，例外也必须有名字** |
| page | `--text-page` | 1.5rem (24px) / 700 / -0.02em | `.u-title-page` | **每屏唯一的 h1** |
| stage | `--text-stage` | 1.0625rem (17px) / 600 / -0.015em | `.u-title-stage` | 工坊六段当前段标题 |
| section | `--text-section` | 0.875rem (14px) / 600 / -0.01em | `.u-title` | 卡片/区块小标题 |

正文不是档，是 Tailwind 默认刻度：`text-sm`(14px) 是**应用默认正文**（`card`、`Button` 都落在这档），`text-xs`(12px) 是副说明。**不要在调用点写 `text-[13px]` 这类字面字号**——要更大的字先在 `@theme` 加具名档。

**h2/h3 刻意不入判据**：区块级标题保留 10.5–14px 的几档微排版（画布节点标签、日志小节、属性表列名各一档），并成一档会**压平信息层次**。要更严的约束就写成**该屏自己的守卫**（例：`src/components/workshop/workshop-heading-structure.test.ts`），别升成全局规则。

---

## Layout

### 间距

`--spacing` 未被重定义 ⇒ **Tailwind v4 默认 0.25rem，根字号 16px**（`scripts/tw4-spacing-canonical.mjs:37` 自己断言这个前提，一旦项目重定义就直接报错退出）。所以 `p-4` = 16px、`gap-1.5` = 6px，`min-h-[22px]` 应写成 `min-h-5.5`。

四条**布局决定**的具名刻度，与通用刻度同级（`--spacing-*` 命名空间顺带生成工具类）：

| token | 值 | 为什么是布局量而非像素凑数 |
| --- | --- | --- |
| `--spacing-title-bar` | 2.25rem (36px) | 标题行高，`TitleBarTabs` 高度与全屏视图让位**同取这一处**（壳态下 `[data-shell] [data-slot="sidebar-container"]` 靠它让位） |
| `--spacing-stage-rail` | 13rem (208px) | 工坊竖向阶段轨道列宽，要装下「徽章 + 阶段名 + 完成度小字」的最长一行 |
| `--panel-right-width` | 360px | 右侧面板宽，动画走 `transition-all + w-(--panel-right-width)`（主规范 §4.4.3 的面板级例外） |
| `--card-spacing` | `--spacing(4)`=16px / `data-[size=sm]` → `--spacing(3)`=12px | `ui/card` 的局部变量，一个开关换两档内距 |

全局常驻的底栏/日志面板要求贴底内容**自己预留 24px（`pb-6`）**，不再逐页补挂（`src/app/layout.tsx:41-42`）。

### 层级是一张刻度表，不是「挑一个够大的数」

| 档 | 值 | 谁在这一档 |
| --- | --- | --- |
| `base` | 10 | 画布节点内容 / 子图 / 卡片内遮罩（参照点是自己的定位祖先） |
| `canvas-ui` | 20 | 画布 chrome：工具栏 / 侧栏 / 面板 / 角标 |
| `canvas-max` | 30 | 画布最上层：IO 预览 / 底部工具栏 |
| `modal` | 90 | 模态遮罩与抽屉（应用内的「顶」）；`overlay` 是它的旧名 |
| `popup` | 100 | **挂在 body** 的下拉 / 气泡 / 节点 JSON 浮层 |
| `toast` | 1000 | 全局提示 |
| `chrome` | 2000 | 窗口标题行——恒在最上 |

四条判据（`src/lib/shell/overlay-z.ts` + 规范 16 §16.2.5，`tests/overlay-z-scale.test.ts` 钉住两份数值一致）：

1. **`modal` 绝不进 1000~1200**——那是 React Flow 给节点选中态（约 1010）与悬浮态（1180）留的位。
2. **`popup` > `modal`**——挂在 body 的下拉是由**模态内部**的控件打开的，低于模态就等于「点得开、点不中」。
3. **画布内部层级不属于本表**——从 `base` 起排是为了「同一容器内的关系有名字」，不是要和模态比高低。
4. **`chrome` 严格最高**——几何让位只保证「不被盖住」，挡不住第三方往 body 注入的整视口遮罩（base-ui 的 `InternalBackdrop` 是 `fixed inset-0; z-index: auto`）。

写法：CSS 用 `z-popup` / `z-modal`；行内用 `Z.*`（`~/lib/shell/overlay-z`）。写了表外的数由 `pnpm ui:overlay-z` 拦下。

---

## Shapes

**实际生效的圆角刻度是以 `--radius: 0.75rem`(12px) 为基数的一套倍数**（`@theme inline`，`globals.css:1005-1011`）：

| 类名 | 表达式 | 计算值 |
| --- | --- | --- |
| `rounded-sm` | `--radius × 0.6` | 7.2px |
| `rounded-md` | `--radius × 0.8` | 9.6px |
| `rounded-lg` | `--radius` | **12px** |
| `rounded-xl` | `--radius × 1.4` | 16.8px |
| `rounded-2xl/3xl/4xl` | `× 1.8 / 2.2 / 2.6` | 21.6 / 26.4 / 31.2px |

- **卡片/浮层用 `rounded-xl`**（16.8px），**控件（按钮、下拉触发器）用 `rounded-lg`**（12px），**输入框用 `rounded-md`**（9.6px），**chip/药丸用 `rounded-full`**（999px）。
- 小尺寸控件靠**取小**而不是换档：`rounded-[min(var(--radius-md),10px)]`（Button `xs`/`icon-xs`）、`min(var(--radius-md),12px)`（`sm`/`icon-sm`）。`ui/` 里 15 处 `rounded-[...]` 有 11 处是这种**从 token 派生**的写法，只有 3 处是裸值（`rounded-[2px]`×2、`rounded-[4px]`×1）。
- ⚠️ `@theme` 里那套 `--radius-sm/md/lg/xl: 8/12/16/20px` **从未生效**，见下方 Conflicts。

---

## Elevation & Depth

扁平为主：**纯色、无阴影、无模糊、无渐变发光**（`globals.css` 的 flat-design utility layer）。投影只留给「浮起来的东西」：

| token | 浅色 | 深色 | 用在 |
| --- | --- | --- | --- |
| `--shadow-card` | `0 4px 20px rgb(0 0 0 / 0.18)` | `… / 0.55` | 浮层卡片 |
| `--color-shadow-strong` | `rgb(0 0 0 / 0.18)` | `rgb(0 0 0 / 0.55)` | 画布浮层重投影 |
| `--color-ring-shadow` | `rgb(0 0 0 / 0.08)` | `rgb(255 255 255 / 0.1)` | 浮层 1px ring——**浅色下用中性灰，不用前景色** |

分隔靠**边框**而不是阴影：`.u-card` / `.u-border` 都是 `1px solid var(--color-border)`。hover 靠**边框混色**表达「可点」：`color-mix(in srgb, var(--color-primary) 35%, var(--color-border))`。

原生控件与滚动条跟主题：`color-scheme: light` / `.dark` 下 `dark`。滚动条外观**全库唯一出口在 `globals.css`**，三档刻意不同（全局兜底 / `.custom-scrollbar` 密集日志 / `.soft-scrollbar` 文字编辑），`src/**` 里不得再出现 `::-webkit-scrollbar`（`scripts/check-ui-primitives.cjs` P4 拦）。

---

## Motion

实测到的动效词汇：`transition: … 0.15s ease`（`.u-card-hover` / `.u-input` / `.u-chip` / `.u-ghost` —— ⚠️ 这四条 `.u-*` 规则**全仓零消费者**，它们的 0.15s 目前不参与任何渲染，见 Known Gaps）、`transition-all`（Button 基类 18 处）、`active:translate-y-px`（按压下沉）、`animate-spin`（spinner）、`animate-pulse`（skeleton）。三条自定义循环：`progressStripe`（不确定进度条）、`wf-wave 6s linear infinite`（生成进度水面）、`tw-shimmer`（**来自依赖** `shadcn/tailwind.css` 的 `@utility shimmer`，本仓 `src/` 零调用点，见 Known Gaps）。一条一次性：`value-tick`（220ms，值变了闪一下 —— 只动 `opacity`、位移为 0，在 §6.7 里按第 ① 档降级，因为它每轮询周期重播一次）。

规范 06 §6.7 要求：**所有 `transition` / `animation` 必须有 `prefers-reduced-motion` 降级**；滑入抽屉 200–300ms、不超过 500ms。唯一登记的刻意例外是 AutoAnimate 条目级过渡（`disrespectUserMotionPreference: true`，250ms ease-out，只动 `transform`/`opacity`）。

> ✅ **动效选点（2026-10-04）**：存量 8 处 layout 动画逐条裁决为「全部保留」（§2.7.1），
> 并按「表现收益盖过性能代价」加了三件 —— `.value-tick`（值变了闪一下，落在复制反馈
> 与队列读数上）与 `<ExitReminder>`（`:has()` 驱动的「切走会丢」提示条，落在工坊角色阶段）。
> **明确不做**：路由 / 视图页签切换的整页过渡（本仓 `loading.tsx` 只有全屏那一个，
> 过渡态无处安放 ⇒ 做出来是更长的白屏）、列表条目过渡扩到没有「排序换位」交互的队列、
> 以及给「已过期」这类持续状态加脉冲。三类理由见规范 02 §2.7.2。

> ✅ **已落地（2026-10-03，签字：三档分治）**：`globals.css` 末尾的 `@media (prefers-reduced-motion: reduce)` 块按三档处理——① 7 处循环全部停掉、② 2 处大位移归零位移只留淡入、③ 短程 hover/focus **刻意豁免**。§6.7 的条文同步收窄成这三档（不再写「所有 transition/animation」那种实测做不到的话）。执行者 = `tests/reduced-motion-tiers.test.ts`（在 pre-commit 的 C 组固定清单里），它兼管「组件改了 `data-slot` 名字而降级块仍指旧名」那一类不报错的失效。
>
> 两处**必须**带 `!important`，不是风格问题：`ui/progress-bar.tsx` 的不确定条与 `workshop/AgentOverlay.tsx` 的运行中圆点都是**内联 `style={{ animation: … }}`**，行内样式压过层外一切规则——不加就是「系统开了减弱动态而这两块照转」，且没有任何东西会报。
>
> ⚠️ **另记一笔不属于本条的账**：实测有 **8 处动画挂在 layout 属性上**（`ui/progress.tsx:48`、`ui/sidebar.tsx:271/283/462/561`、`ui/navigation-menu.tsx:118/124`、`canvas/RgthreeBodies.tsx:104`），违反规范 02 §2.7「动画只用 transform/opacity，不动画 layout 属性」。它**与 reduced-motion 无关**，签字口径明确要求**另开一刀**，别混修。

---

## Components

组件出口只有一个：**`src/components/ui/`**（186 个文件 = 83 个组件 + 29 个 `.stories.tsx` + 36 个 `.test.tsx` + 38 个 `.ts`）。`src/app/shadcn/tailwind.css` 是 shadcn CLI 的 `@import` 占位（4 行注释、零条规则），**不是**组件出口，也**不是**演示页。

### Button（`src/components/ui/button.tsx`，15 variant × 8 size）

**两支通道在同一个 cva 里并存**，这是本库最容易读错的地方：

- **shadcn 类别名支**（`default` / `outline` / `secondary` / `ghost` / `destructive` / `link`）→ 走 `bg-primary`、`bg-background`、`hover:bg-muted`，别名再转发到项目 token；
- **项目 token 支**（`primary` / `danger` / `success` / `warning` / `info` + 四个 `-solid`）→ 直取 `bg-primary-500/15 text-primary-strong`。

**变体名取语义角色，不取色名**：写 `variant="danger"` 而不是 `variant="red"`，换品牌色时调用处不用改。每组的**文字档都走 `*-strong`**，不跟底色同色相取同一个值（理由见 Colors）。

- 软底（tinted）五支：`primary|danger|success|warning|info` = `bg-<色>/10..15` + `text-<色>-strong`。对应视图里 400 处手写 `<button>` 的主流形态。
- 实心四支：`primary-solid|danger-solid|success-solid|warning-solid` = `bg-<色> text-primary-foreground`。`warning-solid` 用 `bg-warning-strong`——实心琥珀必须取深一档才压得住白字。
- 品牌渐变一支：`gradient` = `.btn-gradient` + `text-on-brand`。它的**底是一条三段渐变**，压不进 frontmatter 那套只期望色值的 `backgroundColor`，所以底色只在正文记：起点 `{colors.primary-solid}` 的深一档 `--color-primary-600`(`#7c3aed`) → 中间 `{colors.accent-deep}`(`#c026d3`) → 终点 `--color-accent-soft`(浅 `#ec4899` / 深 `#ff8ac4`)。⇒ **暗色下这条渐变会比历史上亮一档**（终点自带深档），那是 token 化的既定后果。hover 观感来自 `.btn-gradient` 的 `filter: brightness(1.08)`，变体刻意不再叠 `hover:bg-*`。
- size 8 档：`default`(h-8/32px) `xs`(h-6) `sm`(h-7) `lg`(h-9) + `icon`/`icon-xs`/`icon-sm`/`icon-lg`。
- `ButtonLink`（同目录）渲染成 `next/link`，**共用同一套 variant/size**——Base UI 没有 `asChild`，所以是单独封装而不是包一层。

状态：`disabled:pointer-events-none disabled:opacity-50`；`aria-invalid` 走 `border-destructive` + `ring-destructive/20`（深色下 `/50`、`/40`）；焦点 `focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50`。

> frontmatter 里的 `button-disabled` 只是**在 `default` 变体上**举的一个实例——实现是「任何变体 × 50% 不透明度」，不是一套独立配色。判定时别把它当「禁用态换成灰底」。

### 其余核心件的实现入口

| 件 | 实现 | 关键约定 |
| --- | --- | --- |
| 输入 | `ui/input.tsx`（唯一形态；`.u-input` 工具类**零消费者**，别当第二套在用） | `bg-transparent` + `border-input` + `rounded-lg`(12px) + `px-2.5 py-1` + `h-8` + `text-base md:text-sm`；focus 只换 border，**不出阴影**。⚠️ 它预设了 `w-full`，与 §3.8.1.1「基础件不预设宽度」有张力，见 Known Gaps |
| 卡片 | `ui/card.tsx` | `bg-card` + `ring-foreground/10` + `rounded-xl` + `--card-spacing` 两档 |
| 状态徽标 | `ui/status-badge.tsx`（配色唯一出处）+ `ui/status-dot.tsx`（圆点） | **文案留在调用处**（同一状态在不同界面叫法不同，那是业务文案）。此前七个文件各写一份状态→配色表，同一个「已完成」有三种深浅 |
| 侧栏导航 | `--color-nav-hover` / `--color-nav-selected`（别名 `--sidebar-accent` / `--sidebar-selected`） | **悬停与选中必须是两档**（浅 1.14:1 / 1.42:1，深 1.35:1 / 1.88:1，相对各自的 `--color-panel-deep` 底）。共用一档 = 结构上不可分辨 |
| chip/药丸 | `.u-chip` | `rounded-full` + border hairline + 常态 `--color-ink-muted` 字，hover 才转品牌混色边框 |
| 标题指示条 | `.detail-tab-trigger::after` | 品牌双色渐变 `linear-gradient(--color-primary → --color-accent)`；换基元后颜色只有一个出口 |
| seed 模式图标 | `ui/seed-mode-button.tsx` + `--color-seed-*` | **类型色**：红=固定、绿=增减、骰子=随机。被 SVG `fill=`/`stroke=` 直接引用，变量缺失时 fill 退黑、stroke 退 none，箭头**整条消失且无报错** |
| 骨架 | `ui/skeleton.tsx` | `bg-muted animate-pulse rounded-md` |
| 装饰光晕 | `AuroraGlow`（`ui/aurora-background.tsx`） | 色相走 `--color-aurora-*`，**强度由调用处 `alpha` 决定**；`tone` 选色相、`alpha` 定强度，同一装饰不在多处内联重复 |

### 基元的三条自身纪律（都在规范里，都在事故里）

1. **宽度是调用处的决定，基础件不预设 `w-full`**（03 §3.8.1.1）。`w-full` 与 `w-auto` 同族 utility，编译后按产序决胜，调用处写的那个**不保证赢**。要「铺满」走显式开关（参考 `ui/select-menu.tsx` 的 `fullWidth`，缺省随内容宽）。同理「占满剩余宽」的 `flex-1` 要给**外层**。
2. **靠尺寸表达形态的基元必须自带非行内 `display`**（03 §3.8.1.0）。`width`/`height` 对 `display: inline` 不生效——`<span className="size-6 rounded-full">` 画出来是约 4×20px 的竖线。此前该组件所有落点都在 flex 容器里，尺寸才「碰巧」成立。
3. **基元里不写带变体的尺寸上限**（`sm:max-w-sm` 会排在所有无变体 utility 之后，调用处永远压不过它）。

---

## Do's and Don'ts

给下一批要改这个仓库的人（含 AI），按「会不会静默失效」排序。

**颜色**

- ✅ 语义色一律写**类名**：`bg-node-accent`、`text-ink-icon`、`border-primary/35`。
- ❌ **禁止 `bg-(--color-node-accent)` 这种「属性前缀 + 内联变量」**（03 §3.1.1）。它**编得出来**、`hover:` 也生效，所以不是编译错误，而是**越过语义层**：拿不到语义名、拿不到兄弟 token、tsc/eslint/扫描器全绿。判据一句话——**能不能写成一个类名？能，就必须是类名**。
- ✅ 只有两类允许 `style={{ var(--color-…) }}`：① 值运行时才知道（连线 stroke、节点 accent、`boxShadow` 色相）；② 非 Tailwind 属性承载（React Flow `maskColor`、`Handle.borderColor`）。这两类**也要给随主题的 token**。
- ❌ 不要写 `var(--color-ink, #EDEDF2)` 这种带兜底的引用。它是**装饰性 indirection**：谎称随主题，把单一事实来源悄悄换成局部常量，而且下一个人补上声明时这行会**静默改变外观**。需要两态就新增一颗 token 并两态赋值。
- ❌ **禁止拼 token 名**：`var(--color-aurora-${tone})`、`"--color-" + name`。Tailwind v4 会 tree-shake `@theme` 里没被**字面引用**的变量，拼出来的名字在源码里从没出现过 ⇒ 产物里当场失色、没有任何报错。JS 里按当前主题取色的规定写法是 `useCssColorToken("--color-node-mix-base", "#ffffff")`，**整名写全**。
- ❌ 不在源码里写 `violet-500` / `emerald-400` / `#rrggbb` 表达表面或文字语义（`pnpm theme:check` 棘轮 + 显式豁免清单）。

**主题**

- ✅ 新增一个颜色：先在 `@theme` 加 `--color-*` 并**两态各取值**，再看 `ui/` 基元要不要别名转发。
- ❌ 别给 token 挑「深色下大概能看」的浅色兜底值；别把相邻的两颗 token「顺手统一成一种写法」（`--color-canvas-grid-dot` 把 α 烤进 token，`--color-canvas-grid-line` 只给色相、α 留在调用处 `color-mix()`——因为前者强度是设计定死的、后者是**用户在画布设置里调的**，形态不同是有意的）。
- ❌ 浅色档不要用裸 `:root`（03 §3.6.3）。`:root` 与 `.dark` 特异性相同（0-1-0），**谁写在后面谁生效** ⇒ 裸 `:root` 的浅色档会在深色下恒定胜出。项目 token 用「浅色在 `@theme`、深色在 `.dark`」的源码顺序；别名只需转发一次、不按主题分叉。

**布局与交互**

- ✅ 一排控件防压扁三件套：`whitespace-nowrap` + `shrink-0` + `leading-none`。收窄顺序：收内边距 → 降一档字号（且必须在断点处回升）→ 整排 `flex-wrap` → 溢出滚动。**绝不压扁控件**。可缩容的兄弟块要有**贴着按钮组实测宽度的 min-width 下限**，否则永远等不到换行。
- ✅ 层级从刻度表挑档，不从 0 往上试。
- ✅ 装饰层 `pointer-events-none` + `aria-hidden` + `fixed -z-10`。
- ✅ CSS 走静态文件。❌ 渲染路径上注入 `<style>`（`scripts/check-inline-style.cjs` 硬闸，无按文件豁免——同一个形态本仓库犯过两次）。
- ✅ 图标统一 `lucide-react`；静态直接 import，动态/可序列化 key 走 `<Icon name>`（新增图标先在 `ui/Icon.tsx` 的 `ICON_MAP` 登记）。

**分层**

- ❌ 视图层（`src/components/**`、`src/app/**` 除 `api/`）不得出现 `fetch(` / `vanillaApi.` / `api.x.y.useQuery`——逻辑进 `<feature>/hooks/`，网络层进 `src/lib/<domain>-client.ts`（规范 17，棘轮已在 pre-commit）。
- ✅ 改 `src/lib/**` 前先读规范 18；`lib` 不得 import 视图层。

**可访问性**

- ✅ 正文对比度 ≥ **4.5:1**，大字（≥18px 或 ≥14px bold）≥ **3:1**，**图形对象**（图标、状态点、网格线）≥ **3:1**（WCAG 1.4.11）。这些数字在本仓库是**真量出来的**，不是引用标准：`tests/sidebar-state-contrast.test.ts` 从编译产物量侧栏两档；`e2e/theme-token-consumers.spec.ts` 在真浏览器里量 seed 图标对它**实际所托表面**（`bg-node-accent`）的对比度。
- ✅ 状态色不只靠颜色传达，须配文字或图标。
- ✅ 每屏一个 `.u-title-page` 的 `h1`（读屏按标题跳转），副说明走 `.text-sm text-ink-muted`。

---

## Responsive Behavior

- **桌面优先**：画布/编辑器类页面以 `lg:` 为主档（03 §3.8）。桌面壳最小窗口下的**变形**比溢出更常见，所以上面那套「防压扁三件套」比断点本身更重要。
- **移动优先**：公开落地页/文档页从 `sm:` 起步。
- 关键布局至少覆盖 `sm` / `md` / `lg` 三档。
- 所有 `absolute` 浮层（抽屉、popover、tooltip）需测试 **≤1280px** 视口下不溢出。
- 壳态几何：`[data-shell]` 下侧栏容器 `top: var(--spacing-title-bar)` + `height: calc(100svh - var(--spacing-title-bar))`；浏览器/dev 不打这个标记，侧栏从视口顶起。

---

## Conflicts and Open Decisions

### 冲突 1：圆角有两套定义，`@theme` 那套从来没生效

- **`@theme`（`globals.css:242-245`）**：`--radius-sm: 8px; --radius-md: 12px; --radius-lg: 16px; --radius-xl: 20px`
- **`@theme inline`（`globals.css:1005-1008`）**：同一批名字 = `calc(var(--radius) * 0.6 / 0.8 / — / 1.4)`
- **实测**（把 `globals.css` 真编译一次，读产物里 `:root` 的声明）：每个名字**只有 1 份声明**，且是 `@theme inline` 的 calc 版本 ⇒ `@theme` 那四行是**死声明**。
- **直接后果**：`var(--radius-lg)` 的三条 CSS 规则（`.u-card` 等）注释与 `@theme` 都写 16px，**产物里是 12px**；`var(--radius-md)` 同理是 9.6px 而不是 12px。全仓（去 story/test/snap）Tailwind 半径类走 calc 那套的共 **706 处**：`rounded-lg` 364 处（12→16，**+4px 是主力**）、`rounded-md` 224 处（9.6→12）、`rounded-xl` 107 处（16.8→20）、`rounded-sm` 11 处（7.2→8）。
  > ⚠️ 但 `var(--radius-*)` 那三条规则所在的 `.u-*` 扁平层**全仓零消费者**（见 Known Gaps），所以这一刀里「靠 `var()` 走的那几处」其实看不见变化，**真正会变的全在 706 处类名上**。
- **为什么没人拦**：规范 03 §3.6.4 的 T2「`@theme inline` 不许重名」判据在 `tests/theme-token-single-source.test.ts:174,180` 里**只匹配 `--color-` 前缀**，圆角命名空间不在覆盖面内。这件事的形状和当年 `--color-muted` 被别名顶掉**一模一样**（浅色下 `var(--color-muted)` 拿到 `#f7f8fa` 表面而不是 `#6b6b76` 文字灰，tsc/eslint/主题扫描全绿），只是换了个命名空间所以判据看不见。
- **已签字（2026-10-03）**：认 **8/12/16/20 为设计意图** ⇒ 删掉 `@theme inline` 里那 4 行重名、让 `@theme` 生效，并把 T2 的前缀名单扩到 `--radius-` 防回潮。落地方式 = **直接改 + 人眼看一轮**（先不补视觉基线）。
- **随签要定的接缝**：只删那 4 行的话，刻度会变成 `8 / 12 / 16 / 20` 接 **21.6 / 26.4 / 31.2**（后三档仍来自 calc），`xl → 2xl` 只差 **1.6px**、肉眼几乎不分档，而 `rounded-2xl` 有 **73 处**真实消费者。要么把前段的 +4px 线性延伸成 `24 / 28 / 32`，要么明确接受这个接缝。
- **决策人**：设计/规范 owner。本文件 frontmatter 的 `rounded` 刻度按**①（实测生效值）**写，即 `lg = 12px`。

### 冲突 2 → 已收口：规范 06 §6.7 的 reduced-motion 硬要求，实现里曾经是 0

- 规范：「所有 `transition` / `animation` 必须有 `prefers-reduced-motion` 降级」，唯一例外是 AutoAnimate。
- 实测：`src/`、`public/`、`.storybook/` 里 `prefers-reduced-motion` **0 次**；`src/**` 有 **125 行** `transition-*`（仅 13 行带显式时长），真·infinite 循环 **7 处 / 6 文件**，整屏级滑入只有 `ui/sheet.tsx:66` 一处。
- **已签字（2026-10-03，本轮）**：按**三档分治**收 —— infinite 循环与大位移补降级、112 行默认 150ms 的短程 hover 反馈明确豁免，并把 §6.7 那句「所有 `transition` / `animation`」收窄成这三档。§2.7 的 8 处 layout 动画**另开一笔**，不混修。
- **这不是文档笔误，是缺口**：要么补一条 `@media (prefers-reduced-motion: reduce)` 全局降级（对 `infinite` 那两条尤其必要），要么把 §6.7 改成「按场景要求」并登记豁免。**别把规范留着当「已达成」**。
- **决策人**：a11y owner。

### 待定 3 → 已签字：`--font-title` 的首选字体不随包分发，且**从来没在任何机器生效过**

`Sarasa Gothic SC` 既没有 `@font-face`、也不在 `next/font` 里（`layout.tsx` 只加载了 Geist）。⚠️ 本机复验把「开发机装了、装机才回退」这个直觉**否掉了**：`C:\Windows\Fonts`（563 个文件，可读）与用户级字体目录里**都没有 Sarasa** ⇒ 那 15 处 `font-title` 调用点一直渲染的是 Geist + 系统 CJK。

**已落地（同批）**：只嵌 **Bold 一档**（`public/fonts/SarasaGothicSC-Bold.ttf`，23,892,196 字节）+ `@font-face`，`font-title` 的全部落点都是 700（`font-bold` 或 `.u-title-page`），没有 600 档在用，所以单档够用；许可 **SIL OFL 1.1**，全文随字体放在 `public/fonts/OFL-Sarasa-Gothic.txt`。文件走 **git-lfs**，接线两条：`.githooks/pre-push`（本仓库 `core.hooksPath=.githooks` 会整目录覆盖 `.git/hooks`，LFS 装在那里的钩子不会被调用）与 `scripts/install-git-hooks.mjs` 里的 `git lfs install --local --manual`（新克隆没有全局 `filter.lfs.*` ⇒ 规则落空、23 MB 按原字节进历史）。执行者 = `tests/embedded-title-font.test.ts`（在 C 组固定清单里），它判四环是否都还接得上，并核 index 里确实是指针、指针 `size` 与工作树字节数一致。

> ⚠️ 订正我先前的一句话：**「换成系统 Noto」不是一条已验证的零成本路**。`NotoSansSC-VF.ttf` 确实在本机字体目录里，但我没有区分它是 Windows 自带还是后来装的——若它是后者的话，「改用 Noto」等于把「从来没生效」换成「装机大概率也没生效」。中文 Windows 必然自带的是微软雅黑，而它**本来就在**回退栈里。结论：**只有内嵌才真正保证观感**。

### 待定 4 → 已落地：`.btn-gradient` 三颗星改走品牌 token，并补出 `variant="gradient"`

原来 `globals.css` 里是三条字面量 `#7c3aed → #c026d3 → #ec4899`，注释写明是「扁平规范中的有意例外」。实测它的**两端与现有 token 逐字同值**（`#7c3aed` = `--color-primary-600`、`#ec4899` = `--color-accent-soft` 的浅档），只有中间那颗没有对应 token。

**签字口径 = token 化 + 出一支变体**，本轮已落地：新增 `--color-accent-deep: #c026d3`（**两态同值**，理由写在 `@theme` 那条注释里：品牌渐变不随主题换色相），`.btn-gradient` 三段全改成 `var()` 引用 ⇒ **改品牌色时渐变跟手**；`Button` 补 `variant="gradient"`（= `btn-gradient text-on-brand`，刻意不带 hover 底色类，否则 utilities 层会把 `.btn-gradient` 的 transition 整条洗掉），4 处 `<Button>` 调用点收进变体。

**一处要接受的观感变化**：终点 `--color-accent-soft` 自带深档 `#ff8ac4`，所以**暗色主题下的 CTA 渐变会比以前亮一档**（浅色主题逐字不变）。这是「跟着品牌 token 走」的直接后果，不是笔误。

`CanvasNodePrimitives.tsx` 里那处**不是 Button**（画布节点内的共享 class 常量），仍直接写 `btn-gradient` —— 定义只有一处这件事已经成立，那一档没有可套的变体。

---

## Known Gaps

- **Storybook 覆盖 29/83**（有 story 的组件：alert、aspect-ratio、avatar、badge、button、empty-state、field、form-field、form-rhf、image-viewer、json-viewer、kbd、list-badge、media-thumbnail、option-list-popover、page-loading、progress-bar、seed-mode-button、segment-popover、simple-key-handler、skeleton、source-tag、spinner、status-badge、status-dot、task-type-chip、toggle、validation-error-list、water-fill-progress）。核心交互件里 **input、dialog、select、card、tooltip、popover、switch、checkbox、tabs、dropdown-menu、context-menu、menubar、navigation-menu、command** 无 story；其中 dialog/select/tabs/dropdown-menu/card/input/switch/checkbox **同时无 `.test.tsx`**。⇒ 「明暗两态长什么样」这一层契约目前只在那 29 个组件上可核验。
- **`.u-*` 扁平工具层全仓零消费者**（实测，量具自证：同一 grep 在 `u-title` 上抓到 51 处、`u-title-page` 18 处，所以这个 0 不是解析失效）：`u-card` / `u-card-hover` / `u-input` / `u-ghost` / `u-chip` / `u-surface` / `u-border` / `u-avatar` 各 **0** 处，只在 `globals.css` 的 `@layer components` 里有定义。三件后果要如实记下：① 上一版本文件把 `.u-input` 写成「与 `ui/input.tsx` 并存的第二种输入形态」——**错了**，实际输入框只有一种（`ui/input.tsx`：`bg-transparent` + `border-input` + `rounded-lg` + `px-2.5 py-1` + `h-8` + `text-base md:text-sm`）；② 「标题四档」那节的论证依赖 `.u-title*` 在被用，那**一组确实有消费者**（按类名精确计数：`u-title` 26 处、`u-title-page` 17 处、`u-title-stage` 1 处、`u-title-hero` 1 处），所以 §3.10 的判据不受影响；③ §3.6.4 讲 T2 重名事故时举的证据是「`.u-chip` / `.u-ghost` 的小字在浅色下几乎看不见」——那两个类今天**不渲染**，该事故的另一半（`WorkflowNodeJsonPopover`）才是可见现场。**别把这几条类当活代码复用**：要用就照 `ui/` 基元的形状来，不要在视图里捡 `.u-*`。
- **`ui/input.tsx:12` 预设了 `w-full`**，而规范 03 §3.8.1.1 的原文是「基础件里不要预设 `w-full`，宽度是调用处的决定」。对单行输入而言铺满大概是有意为之（该条的事故现场是**并排的下拉**，不是输入框），但**条文没有按角色区分** ⇒ 要么给输入框一个明确豁免，要么把 §3.8.1.1 收窄到「会和其它控件排在同一行的件」。**needs-design-decision**。
- **全站圆角改档几乎没有现成的视觉能量测得住**（签字「直接改 + 人眼看一轮」时必须知道的那一格）：`toHaveScreenshot` 全仓只有 **2 处**（`e2e/visual/login.visual.spec.ts:49,66`，基线是 `-chromium-win32.png`），而 **playwright 不进 pre-commit**；`e2e/**` 里 `borderRadius` 断言 **0 处**（该套用例只断 `color` / `backgroundColor` / `fill` / `stroke` / `width` / `height`），`tests/visual-baseline-pairing.test.ts` 只核「基线文件齐不齐、名字对不对平台」不比像素。所以 `+4px` 那一刀落地后，**除了登录页那一处，没有任何自动化会告诉你哪里变形了**。规范 03 §3.6.1.1 那句「刻意不比像素」的理由（基线按平台分文件）仍然成立，别顺手把它推翻——要补的是**代表屏的截图用例 + 一个手动跑的入口**。
- **frontmatter 只能表达一态**，而本库的取值规则是两态。上面的 `colors` / `rounded` / `components` 全部取**浅色档**（因为 `@theme` 写的就是浅色），而**默认主题是 Dark**。任何人拿 frontmatter 当「应用现在的样子」会得出反的结论——两态对照请看 Colors 表。
- **`--radius-sm` / `--radius-xl` 在真实构建下会被 tree-shake 出 `:root`**（实测：非 static 编译下这两颗声明数为 0，`--radius-md` / `--radius-lg` 因为被 `.u-input` / `.u-card` 引用而存活）。现在没有代码用 `var(--radius-sm)` 去读它，所以还不出事；但**一旦有人在 `style={{}}` 里写 `var(--radius-sm)`，它就是一个幽灵变量**。
- **两条字面字号住在 `@theme` 之外**：`.json-view.jv-theme-comfy` 的 11px/1.6、`.cb-code-block` 的 11.5px/1.65。它们是**内容尺寸**（等宽代码/JSON 的密度决定可读性），不是排版档，但和 `--text-*` 一样都是「改档要改两处」的形态——本文件把它们记成 `code-md` / `code-json` 两档，落档与否待定。
- **`--shimmer-` 那条白名单不是「死豁免」，是「读错了文件」**（订正上一版的说法）：`tests/theme-token-single-source.test.ts:146` 登记着 `--shimmer-` 前缀，而它读的是 `src/app/globals.css` 的**源码文本**——那里确实没有 `--shimmer-*`。但**编译产物里有** `--shimmer-angle`（在 `src-tauri/static/.next/static/chunks/*.css` 里可见），来源钉在 `node_modules/shadcn/dist/tailwind.css:620` —— 即 `globals.css:3` 那句 `@import "shadcn/tailwind.css"` 带进来的。所以那条登记**有真实出处、不该按「死豁免 = 负债」删掉**；真正要记的是判据的口径边界：**它只核本文件里的裸声明，看不见依赖带进来的同名变量**。

---

## 取证方法（任何人可以复算）

本文件每个数字的来源。**不要用命名推断替代这些测量**——上面两条冲突都是「看起来对、实测反」的形态。

```bash
# 1. 圆角谁赢：复用仓库现成的编译路径，数 :root 里每个 --radius-* 的声明次数
#    （tests/helpers/theme-tokens.ts 的 compiledGlobalsCss() 已经把 globals.css
#     用 @tailwindcss/postcss 真编译一次；起一条一次性用例读它的产物即可）
#    实测：每个名字 **1 次**，值来自 @theme inline 的 calc；@theme 那 4 行不在产物里

# 2. token 规模（当前 master 实测：@theme 88 / @theme inline 28 / .dark 72 / :root 47 / 唯一 --color-* 名 115）
awk '/^@theme \{/,/^\}/' src/app/globals.css | grep -cE "^\s+--color-[a-z0-9-]+:"
awk '/^\.dark \{/,/^\}/' src/app/globals.css | grep -cE "^\s+--color-[a-z0-9-]+:"

# 3. T2 的实际覆盖面（只比 --color-，所以圆角不在里面）
sed -n '167,192p' tests/theme-token-single-source.test.ts

# 4. 基元库是谁（Radix 命中应为 0）
grep -rn "@radix-ui" src | wc -l
grep -rln "@base-ui/react" src/components/ui | wc -l   # 35

# 5. reduced-motion 缺口
grep -rn "prefers-reduced-motion" src public .storybook | wc -l   # 0
grep -rn "transition-" src/components | wc -l                     # 113

# 6. 视图层写死色的权威结论（不是本文件的估计）
pnpm theme:check

# 7. oklch 落 sRGB：两颗 destructive 都超出 sRGB 色域，必须让浏览器自己算
#    （getComputedStyle 在较新 Chromium 里会把计算值原样序列化回 oklch()，读不到 rgb；
#     可行做法是 canvas 2d：fillStyle = oklch(...) → getImageData 取回真实字节）
# 8. 输入框只有一种形态：`.u-*` 扁平层的消费者计数（八个 0 才是结论）
for c in u-input u-card u-ghost u-chip u-surface u-avatar; do printf "%s " "$c"; grep -rn "\b$c\b" src --include=*.tsx --include=*.ts | grep -vc globals.css; done
#    ↑ 先用量具自证：同法在 u-title 上给 26、u-title-page 给 17，所以那排 0 不是解析坏了
# 9. transition 存量的正确数法（行数、并分开显式时长）
grep -rn "transition-" src --include=*.tsx --include=*.ts | grep -vc "\.stories\.\|\.test\.\|__snapshots__"   # 125
grep -rn "duration-[0-9]" src --include=*.tsx | grep -vc "\.stories\.\|\.test\."                              # 显式时长那一小撮
#    ⚠️ 别只 grep animate-spin / animate-pulse 就报 infinite 存量：四个命中里两个是注释
# 10. 标题字体到底有没有在任何机器生效过（本机两个目录都查，且要报出目录非空）
ls /c/Windows/Fonts | wc -l && ls /c/Windows/Fonts | grep -ci sarasa   # 563 / 0
ls "/c/Users/yuedu/AppData/Local/Microsoft/Windows/Fonts" | grep -ci sarasa
# 11. --shimmer- 的来源（判据读本文件源码，声明在依赖里）
grep -rn -- "--shimmer-angle:" node_modules/shadcn/dist/tailwind.css
```

**维护约定**：改了 `globals.css` 的 token、或改了 `docs/standards/03`/`06`/`16` 的样式判据，**同步改本文件**。本文件的正文与 frontmatter 若与 CSS 不一致，**以 CSS 为准**，并把它当一次回归来修——这正是它上面那些冲突能被发现的原因。

**这条约定有执行者**：`tests/design-md-contract-sync.test.ts`（在 pre-commit 的 C 组固定清单里）核两件事——本文件引用的每一颗裸 `--color-*` 在编译产物里有声明，以及上面那张语义角色表里所有单一 hex 的格子等于产物解析出的两态取值。它管不到的边界写在文件头：frontmatter 的压平值、并列多颗 token 的单元格、`oklch … ⇒ #hex` 那种形态都不做等值断言。
