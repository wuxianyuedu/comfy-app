## Fixed

- **超长视图文件的拆分提醒（R5）漏掉了整个 `src/app/`（ISSUE #535）**：R5 原先只扫 `src/components/`，而页面的「纯展示视图」按规范 §17.2 第③层放在 `src/app/` 下 —— 结果是**全仓库最大的那个视图 `settings/SettingsPageView.tsx`（2498 行）反而没有任何护栏**，`LogPanel.tsx`（1099 行）这类在 `components` 下的会被提醒，规模更大的却无人过问。现在扫描范围补上 `src/app/`，只提醒不阻断（补齐后立刻亮出 3 个候选：`SettingsPageView.tsx` 2499 行、`LogPanel.tsx` 1100 行、`WorkflowEditorInner.tsx` 910 行）。
- **本次只补「目录」维度，不动文件类型口径**：R5 历来只判 `.tsx` 等会被渲染的视图文件，`.ts` 逻辑模块的拆法由 §4.1 / §12 另管。顺手把 `.ts` 一起纳入会在同一个 PR 里悄悄改变大量文件的判据，故留作后续独立评估。
