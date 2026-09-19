## Fixed

- **项目 token 被别名静默顶掉：`var(--color-muted)` 在浅色下取到的是近白表面色，而不是文字灰**
  （规范 03 §3.6.4，ISSUE #672）。`globals.css` 的 `@theme inline` 里有四行
  `--color-primary` / `--color-accent` / `--color-muted` / `--color-border` 重定向回 shadcn
  别名，而 `@theme` 块里同名 token 早有值 —— 编译产物里同名出现两次、后者（层内靠后）
  获胜，于是**项目 token 的含义被换成了别名**：`var(--color-muted)` 解析成 `#f7f8fa`
  （表面）而不是 `#6b6b76`（文字灰），`.u-chip` / `.u-ghost` 与
  `WorkflowNodeJsonPopover` 里那些小字在浅色下几乎看不见。**tsc / eslint / 主题色扫描器
  全绿** —— 它们扫「写死的色值」，而这里色值本身没问题，错的是 token 解析到了另一处
  同名声明。四行已删；`var(--color-muted)` 被当「弱文字」用的 6 处改到正主
  `--color-ink-muted`（项目原有的 `--color-muted` 与它逐字节同值，已删除重复定义）。

## Changed

- **shadcn 别名不再自己写字面量，改为只做 `var()` 转发到项目 token（规范 03 §3.6.4）**：
  此前别名在 `.dark {}` 与 `:root:not(.dark) {}` 里各写一份字面量，与项目 token 构成
  2~3 份拷贝 —— 把 `--color-surface` 改成别的，`bg-card` 一点不动，这正是「同一个组件
  样式不好改」的机器原因。现在 `--card: var(--color-surface)`、`--border: var(--color-border)`
  这样转发，**两态取值由项目 token 负责，别名只需声明一次**（`:root:not(.dark)` 那个
  「深色下不匹配」的技巧对别名也不再必要）。**没有动 `ui/` 里的任何一行** —— 基元照旧写
  `bg-card`，变的只是它背后指向谁，所以原先把「物理合并」推给「工具生成物怎么承载项目
  命名」的顾虑在正确的合并方式下并不存在。
- 新增两颗项目 token：`--color-on-brand`（品牌实心底上的文字色，原先只作为别名
  `--primary-foreground` 存在）、`--color-ring-shadow`（浮层 1px ring，原先只作为别名
  `--ring-shadow` 存在）。
- **可观测的行为变化只有 4 处**（UI 一致性改动不藏差异）：`--color-muted`（深）`#9a9aad`
  → `#141419`（名字归位为 shadcn 的**表面**语义，浅色档本就如此）、`--secondary`（深）
  `#16161c` → `#141419`、`--sidebar-accent`（深）`#16161c` → `#141419`、`--sidebar`（浅）
  `#ffffff` → `#f0f1f5`。后两者所在的 `--sidebar*` 全库**零引用**；前两者是归一化到
  `--color-subtle` / `--color-panel-deep`（原本浅深两档语义就不一致）。编译产物的
  utility 类集与合并前**逐字节一致**（`bg-muted` / `text-muted` 这类靠桥生成的类没有
  掉过一个）。

## Added

- **`tests/theme-token-single-source.test.ts`**（34 条）：三条判据 —— **T1 单向**（别名值
  必须是 `var(--color-*)`，不写字面量、不按主题分叉）、**T2 不重名**（`@theme inline` 里
  不许出现 `@theme` 已有的名字，重名即静默顶掉）、**T3 无环**（`var()` 链无环、不漏到
  未定义的名字）。T1/T2 读**编译产物**与源码两处 —— 源码文本看不出「同名两处谁赢」，
  那正是上面那个 bug 逃过所有检查的原因。
- **`tests/helpers/theme-tokens.ts`**：token 取值器。真编译 `globals.css` 产物，自己实现
  级联（层外 > 层内、同层后写胜出）与 `var()` 链解析、带环检测。**不能改用
  `getComputedStyle`** —— jsdom 不解析 `var()`，别名改成转发后会返回字面量
  `"var(--color-surface)"`，断言会全部变成误报（实测过）；本文件的做法在 Chromium 里
  逐项核对过。

## Changed

- **`tests/theme-dark-token-cascade.test.ts` 改用取值器**（不再用 `getComputedStyle`）：
  ISSUE #609 那个「浅色 `:root` 恒压深色 `.dark`」的故障形状在别名不再两态分叉后
  已结构性消失，判据改为守它的**等价性质** —— 每个别名两态各取到一个非空、且等于
  它所跟随的项目 token 的值。
