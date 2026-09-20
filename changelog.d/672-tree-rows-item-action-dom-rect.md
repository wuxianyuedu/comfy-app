## Changed

- 前端 UI 一致性（ISSUE #672）再收三条同形态账，判据 P36/P37/P38 一上来就是硬闸：
  - **树的缩进与子行容器**：`~/components/ui/tree-rows` 的 `TreeChildren` / `TreeRow` /
    `indentClass(depth)` 收口 —— 缩进档与引导线是一组语义，行与它的子行绑成一对。
    `expansion-set` 管状态、`Disclosure` 管一行怎么折，本出口管层级怎么画。
  - **「某一条在忙」的执行态**：`~/components/ui/use-item-action` 的 `useItemAction`
    收口 —— 忙标记 + `isBusy` / `anyBusy` 判据 + 同步 `ref` 判重入 + 随条目消失收敛。
    历史列表的重试、角色 / 分镜的 AI 润色、工作流库的下载与同步四处迁移，视图不再
    自己写 `busyId === item.id`。
  - **元素几何的算术**：`~/lib/dom-rect`（`readElementBox` / `offsetWithin` /
    `readLineHeight` / `centerLineScrollTop` / `rectToAnchorRect` /
    `anchorRectToVirtualElement`，量不到一律 `null`）+ `~/components/ui/use-element-box`
    的 `useElementBox`（首帧量一次 + `ResizeObserver` + 等值判断）收口 ——
    日志面板内偏移、视口量测、画布底图尺寸、按行号定位、浮层锚点矩形五处迁移。
  - 规范 16 §16.2.3 判据表补 P36~P38，新增 §16.2.4.39 ~ §16.2.4.41。

## Fixed

- 工作流库下载 / 同步、历史列表重试、角色与分镜的 AI 润色此前**都没有防重复点**
  （`setBusyId(id)` 是异步落状态，同一次事件循环里连点两下会发两次请求）；
  收进 `useItemAction` 后用同步 `ref` 判重入，同一条重复点直接忽略。
- `ScriptMarkdownEditor` 的「跳到第 N 行」在行数为 0 时会算出 `Infinity`
  并把它交给 `scrollTo`；`readLineHeight` 现在给 `null` 并跳过这次定位。
