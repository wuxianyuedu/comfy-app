## Changed

- **首页去掉欢迎区（标题 + 副标题）**（ISSUE #1691 第 1 条）。那块「灵感从这里开始 /
  用本地 AI 模型，自由创作图像、视频与专属模型」一个信息都不给：标题是句口号、副标题
  把四张入口卡的说明重说了一遍，两者连同下方 40px 间距占掉首屏上沿约 150px。删掉之后
  上沿留白同步从 `py-16` 收到 `pt-10`（64px 的顶留白在整条内容列之上等于又加了半块
  欢迎区）。
  随之退役的是它专用的那一档字阶 `--text-hero` / `.u-title-hero`（ISSUE #1691 同名
  决策）：零消费者的具名档留着，代价是「屏级标题只有唯一一档」这句话在后一个想写
  `text-[34px]` 的人面前就不成立。判据 `scripts/check-ui-primitives.cjs` 的 **P83**
  同步收窄到只认 `u-title-page` / `text-page`，并补了一条反例（退役的档不再是合规出口，
  防止「类删了、判据还放行」的静默失效）。
- **首页「就绪锚点」收进一处**（`e2e/support/home-anchors.ts`）。此前三份 spec
  （`smoke` / `critical-flows` / `project-context-refresh`）各自把锚点写成那个大标题，
  于是它一被删就是三处一起红、而红的原因不是「首页坏了」是「锚点没了」。新锚点是四张
  入口卡里的第一张「新建画布」—— **静态**（不依赖在线态 / 模型计数 / 有没有项目这些
  随机器与上下文变的东西），且正是用户进首页第一眼要看的东西。

  > 收编时共用这枚锚点的另有 `e2e/visual/*.visual.spec.ts` 那两份越屏用例（合计五份），
  > 那条像素回归线已按 ISSUE #1620 整档撤掉 —— 所以锚点落地的形态是三份，不是五份。

## Fixed

- **侧栏「项目」分组在全局视图上也亮着一项，可那一屏根本没有这个项目**（ISSUE #1691
  第 2 条；用户原话「项目未显示，默认有个选中」）。判据此前是
  `project.id === activeProjectId`，而活跃 id 是**跨视图常驻**的（新建项目、从最近项目
  点进来都会写它），首页 / 模型 / 历史这些全局视图上却一处都没有那个项目的影子 ——
  读起来就是「你已经在这个项目里，只是内容没显示出来」。改成
  `insideProject && project.id === activeProjectId`，其中 `insideProject =
  isProjectTab(active)`：只有那六个「每一屏只讲当前项目」的视图上，「亮着的那一项」与
  「屏幕上这块内容」才是同一件事。两侧回归见
  `src/components/studio/AppShell.sidebar-project-highlight.test.tsx`。
- **打开工作流编辑器时的过渡屏盖掉整窗**（ISSUE #1691 第 3 条；用户原话「点击流程会有
  一个全屏的加载，需要去掉，加载只覆盖右侧部分」）。`WorkflowEditorLoadingScreen` /
  `WorkflowEditorErrorScreen` 与工作流库那份 `next/dynamic` 的 `loading` 此前都走
  `FullScreenLayer`（`fixed` 定位、从标题行下沿铺到窗口底边）—— 那一两秒里**侧栏与视图
  页签整条被盖住**，用户连「换个视图等一下」都做不到。三处改成
  `absolute inset-0`（由**定位祖先**收窄：壳的内容列是 `relative`），于是只覆盖内容列、
  导航留在原位可点。编辑器**加载完之后**仍是全屏视图（它有意为之的形态，ISSUE #310
  的口径不变），本次改的只是「还没进得去」那一段的覆盖范围。
