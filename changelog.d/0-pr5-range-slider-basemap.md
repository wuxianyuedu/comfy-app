## Changed

- **`ui/range-slider.tsx` 从原生 `<input type="range">` + 自绘渐变背景
  改为 `<Slider>`（`~/components/ui/slider` · base-ui 版）薄封装**（P67
  判据 c 治理，规范 §16.2.3 / §12.18；P67 治理 8/8 清零的最后一步）：
  此前文件头的历史注释解释过不用 `ui/slider` 的**理由**是「换控件会动
  DOM / 交互 / 快照测试」——但 §12.18 明确「改动代价大」**不是**「这一
  处独有的业务」的合法理由。原生 range 与 base-ui Slider 承担完全一样
  的业务（单值滑块），差异只在 DOM 结构与交互实现；而 base-ui Slider
  恰恰把这些代给了更好的键盘/拖拽/a11y 契约：
  - 原生 `<input type="range">` 是浏览器 OS 级控件——深色主题下
    track / thumb 样式跨浏览器不一致（`accent-color` 在 WebKit 只染
    已填充段与滑块），读屏器读的是 OS 播报、样式与语义都不在项目控制内；
  - base-ui Slider 是纯 DOM 组件，默认带 `role="slider"` +
    `aria-valuenow/min/max` + 键盘 ←/→ / PageUp/PageDown / Home/End
    支持，样式走项目 token（`bg-muted` track + `bg-primary`
    indicator + ring focus）。

  **外部 API 完全不变**（`value` / `min` / `max` / `step` / `onChange` /
  `className` 逐字对齐），**两处消费点 0 改动**（`TrainingStudio` 的 4
  个参数 `steps / batchSize / rankDim / networkAlpha`、
  `WorkflowCanvasSettings` 的 SliderRow）。内部：
  - `value` 包一层 `[value]`（base-ui Slider 用数组表达多把手、单把手
    是长度 1 的数组——shadcn wrapper 里的 `_values.length` 判据依赖这个
    长度渲染 Thumb 数量，不能传裸 number 否则走 `[min, max]` 兜底变
    双把手）；
  - `onValueChange` 解一层回 number（用 `typeof v === "number"` 判据
    而**不是** `Array.isArray(v)`——Array.isArray 对 `readonly T[]`
    的 narrow 在部分 TS / eslint parser 版本组合里不收窄、`v[0]` 会
    被推成 `any` 触发 `@typescript-eslint/no-unsafe-assignment`。
    `typeof v === "number"` 走反方向、number 分支先剥掉、else 分支里
    v 会被 narrow 成 `readonly number[]`、`v[0]` 在
    noUncheckedIndexedAccess 下是 `number | undefined`、由
    `typeof n === "number"` 再兜底 narrow）。

  **顺带收窄 props 类型**：老实现 `extends OmitOwnProps<
React.ComponentProps<"input">, OWN_PROPS>` 允许任意 HTML input 属性
  透传（`name` / `form` / `pattern` 等），但 base-ui Slider 不吃这些
  原生 input 属性。实测两处消费点只用了 `value / min / max / step /
onChange / className`，把接口显式列出更贴合实际用法（§12.18 复用优先
  · 不为「可能有别的用法」预留未验证的透传面）。`id / disabled /
aria-label / aria-labelledby` 是 a11y 与测试定位必需、一并留下。
  随类型收窄而消失的还有 `~/lib/clamp` / `~/lib/form-props` 的
  `numberHandler` / `~/lib/dom-props` 的 `OmitOwnProps` 与
  `splitDomProps` 四个 import——本件的私有字段表（`OWN_PROPS`）与
  `fillPercent` 手算渐变百分比的辅助函数一并删除，逻辑改由 base-ui
  接管。

- **`scripts/.ui-primitives-baseline.json` 收紧**：P67 判据 1 → **0** 处
  （棘轮清零）。`range-slider.tsx` 从 files 中掉出、`total: 0`、
  `files: {}`。**自此 P67 是天然硬闸**（新增任何 ui/ 层绕开 shadcn
  已装基元的轮子都会被 `pre-commit` 直接拦下、不再有基线豁免空间）。

- **`TrainingStudio.test.tsx` 快照更新**（`vitest run -u`）：`.snap` 里
  4 处 `<input type="range">` 结构换成 base-ui Slider 的
  `data-slot="slider"`（Root）+ `slider-control`（Control）+
  `slider-track`（Track）+ `slider-range`（Indicator）+ `slider-thumb`
  （Thumb）五层，并带 `role="slider"` + `aria-valuenow/min/max` +
  `aria-orientation` 全套 ARIA（原生 input 只有浏览器 UA stylesheet
  给的隐式 role，DOM 层看不到）。同时**顺带同步了 PR-2 / PR-3 的 DOM
  演化**：`.snap` 里 `role="progressbar"` + `aria-valuenow` 从原来的
  视觉轨道 `<div>` 挪到了外层 `data-slot="progress-bar-track"`（base-ui
  Root，PR-3 治理）；表单行的外层 `<div className="min-w-0">` 变成
  `<Field role="group">`（PR-2 治理）。这几处漂移不是本 PR 引入的、
  是 PR-2/3 未一并 `-u` 快照、本次 `vitest run -u` 顺手把三份 PR 的
  DOM 演化一起对齐。
