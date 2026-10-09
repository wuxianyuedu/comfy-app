## Fixed

非原生元素（`div` / `li` / `span`）上「鼠标点得开、键盘点不开」的点击收口到
零，并给这条边界一个执行者（规范 06 §6.11）。

`eslint-plugin-jsx-a11y` 装着 **39** 条规则，`eslint.config.js` 只启用 6 条 ——
剩下那批里最贴本项目形态的三条（`no-static-element-interactions` /
`click-events-have-key-events` / `no-noninteractive-element-interactions`）
判的是同一件事：**非原生可交互元素挂了 `onClick`，却没有键等价物**。全仓
立案实测 **27 处**。真病灶 6 处，其中消息行 `markRead`、任务卡主体
`onOpenDetail`、「点击查看源码」药丸、「双击重命名」四处鼠标点得开、键盘
进不来；`MultiModeSelect` 与 `AttributeMultiSelect` 的选项行**连 `tabIndex`
都没有**（后者的注释还写着「键盘由 `option-list-popover` 承担」，而它并没有
用那个基元）。

改法两档：整行就是一个动作的换原生 `<Button>`（键语义免费）；行里还有别的
动作、合成一个 `<button>` 非法的补 `simpleKeyHandler`（§16.2.4.57 的元素级
键出口）。「双击重命名」保留双击作为快捷键，另补 Enter / F2。

新增 `scripts/check-click-keyboard.cjs` 走棘轮（`scripts/.click-keyboard-baseline.json`，
当前 0 处，`--update` 拒绝上涨），接进 pre-commit 的 D 组、登记进固定清单。
结构性站点（拖放容器、指针手势面、`stopPropagation` 守卫、容器点击转焦点）
在 `EXEMPT_SITES` 里**逐条写明为什么不需要键等价物**，`--report` 会把它们
打出来。**刻意不给「任意 `{...spread}`」开口** —— `{...props}` /
`{...hoverEvents}` 不是键盘覆盖，只认 `simpleKeyHandler` 这一个出口。
