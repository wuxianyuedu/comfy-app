## Changed

- **P1 按钮分批第二批：`studio/project-canvas/`（含 `CanvasNode/`）18 个文件、84 处手写 `<button>` 清零**，棘轮基线 393 → 309（`scripts/.ui-primitives-baseline.json`）。

  这批的地形比前两批杂，落点覆盖图标圆钮（`size="icon-xs"` / `icon-sm` / `icon-lg`）、Tab 项与筛选 chip（`variant="ghost"` + `h-auto`）、实心紫主行动钮（`variant="primary-solid"`）、带边框的次行动钮（`variant="outline"`），以及 Popover 里的 `role="option"` 选项行。

- **三条口径写进规范 §16.2.4.2**（可直接照抄到下一批）：

  1. **Popover 选项行也换成 `<Button variant="ghost">`** —— base-ui 的 `Button` 把 `role` / `aria-selected` / `title` / `key` 原样透传到 `<button>`，行为不变；`rounded-none` 抵消基元默认圆角，保住行样式的边到边观感。
  2. **`type="button"` 可随转换删掉** —— base-ui 的 `useButton` 自带 `type: 'button'`，不会退化成表单提交钮。
  3. **`h-auto` 是覆盖基元高度的标准手法** —— 基元 `size` 变体写死了 `h-6/7/8/9`，调用处要沿用自己那套 `px/py` 就必须 `h-auto`。

- **§16.2.4 台账**：按钮行不再写死数字（改成「当前值看 `pnpm ui:primitives:report`」，免得每批都改一遍正文），状态改为「分批（已清 3 批）」。

## Fixed

- **修掉 master 上的一颗失败用例**：`LogPanel.test.tsx` 的「级别按钮带级别色」仍在断言 `text-amber-700 dark:text-amber-300` / `text-rose-700`，而上一批（#683）已把 `LogFilterBar` 的级别色换成 `text-warning-strong` / `text-danger-strong` 语义 token —— 断言与实现脱节，测试挂在 master 上。本次把断言改成 token 类名，与 §3.6.2「颜色只有单一事实来源」一致。

  （口径不变：级别色挂在按钮上、由标签文字继承，数字保持中性灰。）
