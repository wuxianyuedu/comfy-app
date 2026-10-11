## Fixed

- **模态弹窗默认带带色遮罩，背后内容点不中**（ISSUE #1742）：`ui/dialog` 的
  `DialogContent` 此前只铺 Portal + Popup，靠基元自动注入的 `InternalBackdrop`
  （`role="presentation"` 的**透明**层，只做外部点击判定）兜住 —— 于是绝大多数
  弹窗背后又亮又像能点（现场：数据库过期确认弹窗背后整块首页照常发光）。现在
  `DialogContent` 默认渲染共享遮罩 `DialogOverlay`，只有极少数内嵌场景才传
  `showOverlay={false}` 退出。
- 遮罩底色收口到语义 token `--color-scrim`（浅 / 深两态各自取值），替换写死的
  `bg-black/*`：`ui/dialog` / `ui/sheet` / `ui/fullscreen-dialog` 三处共用同一份
  （全屏视图此前另传 `bg-black/40`，与弹窗是两套底色）。
- 新增判据 `tests/dialog-backdrop-contrast.test.ts`：从编译产物真量「遮罩把最亮的
  常见表面压暗了多少」，并钉住 `bg-scrim` 这条 utility 真进了产物。
