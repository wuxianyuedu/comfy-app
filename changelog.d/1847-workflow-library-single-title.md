## Changed

- **「流程」这个导航名改成「工作流库」，屏内那行重复的大标题一并去掉**（ISSUE #1847）。主页那张功能卡一直写的是「工作流库」，而侧栏 / 页签 / 顶栏写的是「流程」—— 同一件事两个名字，用户点进去还得再认一次。现在名字从 `NavItems` 注册表改起（`label` 一处），侧栏、页签、顶栏标题跟着同一处变。
  - 屏内 `WorkflowLibraryHeader` 那行 `.u-title-page` 的 `h1`「工作流库」是**同一个名字出现两次**：顶栏与页签常驻已经写着它，标题区却实打实吃掉一整行（ISSUE #1693 的下半截）。改成 `sr-only`，名字仍从 `pageHeaderTitle("workflows")` 取（不另写字面量），读屏仍能按 `h1` 跳转 —— 「别占空间」与「没有标题」是两件事。
  - 判据：`WorkflowLibraryHeader.tsx` 不再出现 `u-title-page`、`h1` 带 `sr-only` 且名字走注册表出口（`WorkflowLibraryLayout.test.tsx`）；顶栏标题跟到新名字（`TopBar.test.tsx`）。

## Fixed

- **P83 盲目要求每个 `h1` 都挂 `.u-title-page`，误伤「只给读屏的跳转锚点」**（ISSUE #1847）。`sr-only` 的 `h1` 不占视觉空间、不冒充可见标题，字阶档根本不该挂（挂了也不生效）。判据改认 `sr-only` 这个**形态**（不是给某个文件开白名单）：`ui/page-header` 的 `srTitle` 此前只因落在 `ui/` 的 `EXEMPT_DIRS` 里才没被计，视图层写同一形态就会被拦。正反例进了 `tests/check-ui-primitives.test.ts` 的 P83 差分组。
