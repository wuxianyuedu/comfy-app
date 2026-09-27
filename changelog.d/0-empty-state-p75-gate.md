## Added

- **UI 基元棘轮新增 P75「视图层手搓空态卡」（棘轮，`scripts/check-ui-primitives.cjs`）**：
  shadcn `composition.md`「Use `Empty` for empty states. Don't build custom
  empty state markup.」。项目里装了官方 `~/components/ui/empty.tsx`
  （`<Empty>` + `EmptyHeader/Title/Description/Content/Media` 组合）· 与
  项目自立的 `~/components/ui/empty-state.tsx`（`<EmptyState>` · page/error/hint
  三档 · 官方 Empty 的薄封装 · 补 icon 位与最小高度）。视图里出现手搓的
  空态占位卡就是绕开这两个基元。

  **判据是四重条件、少一条都不算**：
  - ① className 里 `border-dashed` + `rounded-(xl|2xl|3xl)` **双有**；
  - ② **非自闭合** div（自闭合的是 P73 那条虚线、或 flex-1 装饰填充线）；
  - ③ className 里**不含** `cursor-pointer`、inner 里**不含** `onClick=`
    （排除"点击添加占位"这类交互 · HomePage 里"新建项目" dashed 按钮就是这种）；
  - ④ inner trim 后至少 5 字符（排除装饰性空 div · 只当 padding 用）。

  **P73 与 P75 互斥**（P73 只拦自闭合、P75 只拦非自闭合）· 差分回归第 4 例
  锁死这一点：同一个自闭合 dashed div 被 P73 拦、P75 **不**同时报。

  走棘轮（非硬闸）：本会话摸底命中 **12 处**（`changelog.d/0-session-final`
  里列出）· 冻结起点。**下一批按域分片**把每个 `<div>` 迁到
  `<EmptyState variant="page" title="…" description="…" />` 或 `<Empty>`
  组合 · 清零后独立 PR 升硬闸（同 P76-P80 节奏）。

  **P74 编号跳过**：`bg-X/N + text-X-strong` 组合锚点在本仓库**命中 0**
  · 手搓 callout 里同用两件事的模式稀有 · 判据立起来会变"死判据"
  （无假阳 · 也几乎无真命中）· 若将来发现真需要 · 由更精的 AST 扫描器
  做 · 不塞进这条正则棘轮。

## Tests

差分回归 4 例见 `tests/check-ui-primitives.test.ts`：
- 手搓空态卡（border-dashed + rounded-xl + 内含文本）→ 阻断；
- 有 `cursor-pointer` 的 dashed「添加占位」不误伤；
- 内含 `onClick=` 的 dashed 卡不误伤；
- 自闭合虚线分隔线不误伤（P73 拦、P75 **不**同时报）。
