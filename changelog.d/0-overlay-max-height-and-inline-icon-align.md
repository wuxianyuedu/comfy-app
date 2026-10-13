## Changed

- **浮层的最大高收成两档常量**（新增 `src/components/ui/overlay-max-height.ts`，与
  `ui/dialog-width` 同形）：**85vh** = 居中模态 / 图片看全 / 弹层面板那 6 处的事实档，
  `78vh` 与 `90vh` 各一处是同一角色上的**漂移值**（差那 5–7 个百分点没有任何一处文档说过为什么）
  → 并入；**70vh** = 页面里自滚动的卡片区，另一个角色（上限要留出周围内容的呼吸），3 处。
  共 11 处调用点改走常量。
- **两处刻意不收，登记在案**：`WorkflowNodeJsonPopover` 的 positioner `max-h-[60vh]` —— 只有它
  一个消费者，为它立一档就是「为以后可能用得上」留在库里（与 `--text-hero` 退役同一个理由）；
  `ConsoleView` 左栏的 `max-h-[45%]` —— 百分比相对**父容器**而不是视口，量的不是同一件事，
  判据的正则也刻意不收它。
- **为什么是 class 串而不是 `@theme` 的 `--max-height-*`（实测，不是偏好）**：
  `cn("max-h-[85vh]", "max-h-overlay")` **两条都留** —— tailwind-merge 认不出自定义名字属于
  哪一族，于是「谁覆写谁」变成看 Tailwind 的输出顺序，正是规范 16 §16.2.4.12 那次「加宽按钮
  点了没反应」的同族事故；而两条 arbitrary（`max-h-[85vh]` 与 `max-h-[70vh]`）实测只留后一条，
  同族冲突照常生效。**所以档位存 arbitrary 串、不存 token 名。**
- **新增 `UI/OverlayMaxHeight` story**（`ui/overlay-max-height.stories.tsx`）：常量模块的对外面
  就是它算出的那两个串，所以把串摊在画布上、并给两枚真盒子 —— 拉窗口即见上限跟视口走
  （真 Chromium 实测：视口 800px 高时两盒分别停在 680 / 560，缩到 500px 时 425 / 350，
  两档之差恒为 15vh）。形态照 `dialog-overlay.stories.tsx` / `media-drag-source.stories.tsx`
  的先例（规范 16 那条「纯常量也要把串摆出来」）。`scripts/.storybook-coverage-baseline.json`
  的 `uiSurfaces` / `covered` 同批 94 → 95（新增一个 `ui/` 面且它有 story）。
- **行内图标的 `align-[-Npx]` 删掉 10 处零效果声明**：11 处里有 10 处坐在 `Button` / `flex`
  容器里，而 `vertical-align` 对 flex item 不起作用。真 Chromium 实测：flex 容器内带与不带
  这份声明，图标的行内偏移都是 4.5px；同一份声明放进 inline 文本流才有效（12px 图标 5px→6px）。
  只剩 `EmptyCanvasHint` 那一枚文本流里的，留着并把「为什么只有它该留」写在那一处的注释上。

## Fixed

- **新加的归零判据差点对着空集绿**：`scanProduct` 只记**有捕获组**的命中，第一版两条正则
  （浮层上限 / 图标对齐）都没写捕获组，于是白名单里的 owner 与调用点一起「扫不到」，判据恒绿。
  是那条「owner 在册就必须扫得到」的正向断言把它抓出来的 —— 现在这类按具名出处放行的判据
  **两条都配**了这条正向断言，口径写进契约 §Shapes ⑦。
