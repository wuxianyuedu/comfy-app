## Added

- **两档微字号具名**：`--text-2xs: 11px`（`text-2xs`）与 `--text-3xs: 10px`（`text-3xs`）。
  不是新设计，是从调用点量出来的既成事实 —— 实测 `text-[11px]` 350 处、`text-[10px]`
  214 处散在 136 个业务文件里，没有名字，于是「改一处全站跟手」对这两个尺寸根本不成立。
- **契约里记一条 `cn()` 的命名硬约束**（docs/DESIGN.md Typography）：`@theme` 里
  `--text-*` 的档名**必须是 t-shirt 尺寸**。`cn()`（clsx + tailwind-merge 的替代件）把
  不认识的 `text-<名字>` 一律归到**颜色**组 —— 实测 `cn("text-ink-muted","text-micro")`
  只剩 `text-micro`，同行的状态色被静默吃掉；`text-2xs` 命中 t-shirt 模式，归 font-size
  组，两条并存。仓库已有的 `text-section` / `text-page` / `text-hero` 是同一个坑的潜伏
  形态（实测同样吃颜色），只是目前没人在 JSX 里用。

## Changed

- **565 处 arbitrary 字号换成类名**（151 个文件）：`text-[11px]` → `text-2xs`、
  `text-[10px]` → `text-3xs`，替换后残留 0。逐像素相同：这两档**不配**
  `--text-*-line-height`，生成的类只出 font-size（实测对照 `text-section`）。
  连带更新两处记账：`FilmStudio` 的 DOM 快照（34 行，全是类名）与
  `workflow-editor-topbar-config.test.ts` 里钉住的那条 className 字面量
  （prettier 的 tailwind 插件会重排类序，这条断言本来就脆）。
- 两档**不乘 `--font-scale`**：设置页「标题字阶」的作用域只有标题四档，微标签跟着
  标题缩放会让密集列表在 125% 档下挤成一团。

## Fixed

- **记下一处「看着等价、其实不等价」的改写并刻意不做**：`text-[12px]` → `text-xs`
  实测会连带 emit `line-height: var(--tw-leading, var(--text-xs--line-height))`
  （= 16px），而 `text-[12px]` 只出 font-size、行高继承 preflight 的 1.5（12px 下是
  18px）。那 107 处留在原地，等一次带视觉复核的独立改动 —— 写进契约与代码注释，
  免得下一个人当免费清理做掉。
