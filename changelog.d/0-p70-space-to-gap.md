## Added

- **`check-ui-primitives.cjs` 新增 P70「视图层用 `space-y-N` / `space-x-N`」
  硬闸判据**（shadcn `styling.md`「No `space-x-N` or `space-y-N`. Use `flex`
  with `gap-*`.」）：`space-y-N` 靠给子元素加 `margin-top`
  （`:not(:last-child) > *` 选择器）实现间距，与 flex / grid 的 `gap`
  是两套机制——混用会让「改间距」要同时找两种写法，且 `space-y-N` 在
  嵌套 flex 容器里会被父级的 `gap` 叠加出非预期间距。

## Changed

- **全库 107 处 `space-y-*` 清零**（55 文件，跨 `components/studio/`、
  `components/workshop/`、`app/(main)/settings/`、`app/login/`）：
  每处按父元素已有的布局上下文替换——
  已有 `flex flex-col` 的只换 `gap-N`；已有 `flex` 无 `flex-col` 的补
  `flex-col gap-N`；已有 `grid` 的换 `gap-N`；都没有的补
  `flex flex-col gap-N`；`space-y-0` 直接删除（零间距、无需任何替代类）。
  FilmStudio / TrainingStudio 快照跟着刷新（className 串变了）。
  P70 进 HARD_GATE_RULES、基线 0——新增即阻断。
