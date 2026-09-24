## Fixed

- **6 个 Dialog 补可访问名**（shadcn Critical Rule「Dialog always need a
  Title」，`aria-label` 兜底、无视觉变化）：`HistoryDetailModal`（任务详情）、
  `logs/LogPanel`（应用日志）、`ModelLibrary`（模型库）、
  `project-canvas/GlobalStepLogPanel`（执行步骤日志）、`SourceModal`
  （查看源文件）、`VideoQueueModal`（视频生成队列）。这些弹窗此前既无
  `DialogTitle` 也无 `aria-label`，读屏器只播报「对话框」、读不出是什么
  弹窗。它们的 header 是各自自绘的可见标题（不走 `DialogTitle`），故按
  `ui/dialog` 的 `DialogContent` → `DialogPrimitive.Popup` props 透传，
  统一补 `aria-label`（与 `ModelTagManager` 的「管理模型标签」、
  `ContentAssetNode` 的「图片画廊」同款写法）。

## Changed

- **`studio/BrowserStatusBar.tsx` 状态色从 Tailwind 字面量改走语义 token**
  （§4.11.1「映射表里的颜色也必须走语义 token」）：两处状态色映射表
  `fpsTextColor` / `fpsDotColor` / `SCHEMA_TONE_CLASS` 此前把
  `emerald-600/400` / `amber-*` / `rose-*` 写死、还各配一条手写 `dark:`
  档——「把成功色换成 teal」对 FPS 指示灯与 schema 同步状态都改不动。
  现在：文字色 `ok → text-success-strong`、`warn → text-warning-strong`、
  `bad/error → text-destructive`（与 `status-badge` / `alert` / `badge`
  家族同一份 token 面板，token 内部已含深浅两态、不再写 `dark:`）；
  FPS 圆点底色 `bg-emerald-400 → bg-success` 等，光晕
  `shadow-[0_0_6px_rgba(52,211,153,0.8)] → shadow-[0_0_6px_var(--color-success)]`
  也改引 token。`info` / `unknown` 档本就是 token（`text-ink-soft` /
  `text-ink-muted` / `bg-ink-fainter`），不动。

  注：`message-center` 的 `KIND_META`（update/restart/info 用
  violet/amber/cyan）是**类型色**（消息分类标识、同 `task-type-chip` 的
  image/video/audio），按 §3.6.1 类型色例外保留字面量，本 PR 不动。
