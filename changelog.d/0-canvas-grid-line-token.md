## Changed

- **画布网格线三处收到一个 token 上**（`src/app/globals.css`、
  `canvas/workflow-canvas-grid.ts` 新增出口 `gridLineColor()`、
  `WorkflowCanvasDecorations.tsx`、`workflow-library/WorkflowLibraryCanvas.tsx`）：
  同一件事原本有三种口径 —— 编辑器两处写死 `rgba(148,163,184, α)` 并登记在豁免表，
  库预览一处写 `var(--color-canvas-grid-line, …)` 而**那颗 token 从未定义过**（永远走
  兜底，读代码的人会以为它随主题，实际不随），豁免清单里只能用**散文**记一句
  「与 WorkflowCanvasDecorations 同源」，机器兜不住。
  现在色相只在 `globals.css` 定义一次并**做成两档**（浅=黑，与相邻的
  `--color-canvas-grid-dot` 浅档同约定；深=`rgb(148 163 184)` 原值 ⇒ **深色主题像素不变**），
  α 留在调用处经 `gridLineColor()` 用 `color-mix()` 现取（线强度是用户在画布设置里调的，
  还要再乘随缩放淡出的系数，所以不能烤进 token —— 相邻两颗 token 形态不同是有意的）。
- **浅色画布下的网格线变清楚了**（用户可见）：细线默认档 α=0.22 从 **1.18:1 → 1.68:1**，
  主参考线 / 库预览 α=0.14 从 **1.11:1 → 1.38:1**。改前浅色的线**比深色更看不见**，
  现在这条反差不再存在（e2e 里按三档 α 逐个验，浅 ≥ 深 成为判据）。

## Fixed

- **「幽灵 token」判据从「按语法位置判」泛化成「按三个条件判」**
  （`scripts/check-theme-colors.cjs`、规范 03 §3.6.1.1）：第一版只认
  `fill=` / `stroke=` 这类呈现属性，于是上面那颗从未定义的 `--color-canvas-grid-line`
  本来就抓不到（它是 `<Background color=…>`）；更关键的是，把网格线**收进出口函数**之后
  引用变成模板串、连属性形态都不是了 —— **集中化这个正确动作本身会让按形态判的判据失明**。
  现在只认「字面量 + 无兜底 + 带 `--color-` 前缀」三个条件，不关心挂在哪个语法位置。
  实测非测试代码里 **175 处**字面引用、查无定义 **0 处**（按属性形态只有 28 处），
  覆盖率 ×6 而不引入误报。
- **删掉两条刚失去对象的豁免**（同上一批加的「死豁免」判据自己点的名）：
  `WorkflowCanvasDecorations.tsx` 与 `WorkflowLibraryCanvas.tsx` 的色值写死消失后，
  它们的豁免一处都不命中了 —— 留着等于给这两个文件今后的写死色值开门。
  豁免命中数 286 → **283**。

## Added

- `e2e/theme-token-consumers.spec.ts` 加第 5 条：**`color-mix()` 在 SVG `stroke` 位置上
  确实解析**，并按三档 α 验浅色不比深色更弱。过程中撞出一条值得记的事实：Chromium 把
  `color-mix(in srgb, …)` 的计算值序列化成 **`color(srgb 0 0 0 / 0.14)`**（分量是 0~1
  浮点）而不是 `rgba()` —— 我第一版拿 `/^rgba?\(/` 断它，得出一条**假红**（值其实是对的）。
  用例里的 `parseColor()` 现在三种形态都认，断言比**分量**不比字符串。
- `src/components/studio/WorkflowCanvasDecorations.test.tsx` 钉「表达式确实送到 DOM」：
  实测 React Flow v12 的 `<Background color=…>` **不写 `stroke` 属性**，而是写成内联
  自定义属性 `--xy-background-pattern-color-props`、真正的 `stroke` 由样式表取它 ——
  所以「送到没送到」在 jsdom 里就能判，「浏览器解析得了」留给上一条 e2e，两层各管一段。
- `tests/check-theme-colors.test.ts` 加 2 条：非属性形态（出口里的模板串）同样被抓；
  以及「色相不许再在任何调用处写回」的收口锚点（复用 `tests/helpers/strip-comments.ts`，
  只判代码 —— 注释里正当地会出现被禁的叙述本身）。
