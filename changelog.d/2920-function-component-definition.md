## Changed

oxlint `react/function-component-definition` 定口径并清零：**具名组件一律 `function` 声明**，
`unnamedComponents` 收 `["function-expression", "arrow-function"]` 两种匿名形态。

口径写在 `oxlint.config.ts`，不是把源码改一遍。预设默认要求具名组件写成箭头 + 变量，
在本仓等于要动 811 处 / 430 份，而全仓 2402 份里 99% 早就是 `function` 声明 —— 这条只把
既成事实写下来。反向读数：按这条口径全仓只剩 7 处，本轮逐条改完（`ui/sonner`、
`ui/form-rhf`、`ui/water-fill-progress.stories`、`ui/use-overlay-boundary.test`、
`studio/project-home/SeriesCharacterLibrary`、`studio/workflow-form/…/SectionHeader`）。

匿名那侧收成数组而不是单选，是量出来的：`function-expression` 会把 `memo(function X(){…})`
这一族 25 处判成违例，`arrow-function` 反过来会把 `render={() => …}` 判成违例 —— 匿名组件在
`memo` / `forwardRef` / 行内三种用法里本就没有统一形态。`memo` 包裹的具名箭头
（`export const X = memo(...)`）本就不在「声明形态」的选择面里，一处未动。

读数（`oxlint --format json .`，2409 份）：该规则 0 命中；`tsc --noEmit` 0；
7 份文件 `eslint --max-warnings 0` 0；相关渲染用例 18 条通过。

#2920
