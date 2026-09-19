## Changed

- **模态浮层也是「同一件事的多种写法」：16 个视图各拼一份外壳，收成 `ui/dialog` / `ui/sheet` 两处**。这批与前面几批形状不同 —— 前几批是「一个动作有几份实现」，这条是**一个形态有很多种写法**，而且 **P2 追不到它**：P2 数的是 `createPortal(`，而这 16 个落点**一处 portal 都没有**（把遮罩写成一个普通 `<div className={overlayClass("modal", …)}>`，靠 `fixed` 铺满）。判据问的是「有没有用某个 API」，于是「用另一种方式做同一件事」全部漏过。
  - 真正的病灶是 **a11y 语义在 16 份之间分叉**：点遮罩关闭 15 份、**Esc 只有 3 份**、`role="dialog"` + `aria-modal` 只有 3 份、**焦点锁与焦点归还 0 份**。也就是说「能不能用键盘退出」取决于用户打开的是哪一个弹窗，而且**没有报错、没有告警**。
  - 迁移：居中卡片 → `ui/dialog` 的 `Dialog` / `DialogContent`（形态差异经 `className` / `popupClassName` 表达，调用处自己的卡片外观原样保留，验收标准是渲染结果不变）；右侧抽屉（`ProjectOutputs` 的元数据面板）→ `ui/sheet`（`side="right"`）；`DeleteWorkflowModal` 是 `ConfirmDialog` 的第二份实现，改成它的薄包装（「确认中不许关」由 `pending` 承载）。
  - **不统一的那两类照旧**：全屏视图走 `FullScreenLayer` / `ui/fullscreen-dialog`（与「居中卡片」是两个形态，基元里早已分家）；画布内部叠层只在自己容器内比高低（§16.2.5 第 3 条）。

## Fixed

- **`LogPanel` 迁到弹窗基元后虚拟化静默退化成整页渲染**：面板内容经 Portal 渲染，**挂载比本组件晚一个提交**，而「量滚动视口」的 effect 只在 `[isOpen]` 变化时跑 —— 那一次 ref 还是 `null`，量测被跳过，之后再也没有第二次。jsdom 里两条分支都渲染全部行，肉眼完全看不出来，只有量 DOM 节点数才发现。现在把滚动元素本身放进 state（ref 回调 `setBodyEl`），量视口的 effect 依赖它：**依赖「元素出现了没有」而不是「面板开了没有」**，量测与挂载方式无关。

## Added

- **P9 硬闸：视图里出现 `overlayClass(` 直接阻断**（`scripts/check-ui-primitives.cjs`，`HARD_GATE_RULES`，不进棘轮基线）。形态锚点取 `overlayClass` —— 本项目顶层浮层定位的唯一出口，视图里出现它 = 在自绘浮层容器。与 P1 同款先过 `stripComments`，把理由写进注释不会让计数停在原地。
- **出口侧契约**（`tests/ui-primitives-coverage.test.ts`）：`ui/dialog` 导出 `Dialog` / `DialogContent` 且业务引用数 ≥8，`ui/sheet` 同样 ≥3。只加 P9 挡得住「新增自绘」，挡不住「下一个人的新弹窗又照抄一份」—— 而 16 处自绘能长期存在，正是因为没人觉得 `ui/dialog` 是必选项（它此前只有 4 个业务引用）。
