## Changed

- **`Button` 补齐 8 个语义变体，P1 批量替换按钮的前提就位**：把 400 处手写 `<button>` 换成 `<Button>`，前提是 `Button` 先有对应变体 —— 否则替换只能把原 class 一字不差搬过去，重复一点没减少，还把「按钮该长什么样」的决定权留在调用处。实测视图里手写按钮用的是 violet / red / rose / emerald / amber / cyan 六个色系，原 `Button` 只有 `default / outline / secondary / ghost / destructive / link`。

  新增的 8 支**按语义角色命名、不按色名**（换品牌色时调用处不用改）：`primary` / `danger` / `success` / `warning` / `info`（软底）与 `primary-solid` / `danger-solid` / `success-solid`（实心）。软底是主力形态（手写按钮绝大多数是这个），实心只出实测用到的那三色；每个软底变体的文字档走 `*-strong` token（同一个琥珀色当底色可以、当浅色底上的文字色对比度不足）；既有 6 个变体一个不动。

- **补掉一颗哑弹：`--color-warning-strong` 从未定义**：`ui/status-badge.tsx` 引用 `text-warning-strong`，但该 token 在 `@theme` 里根本不存在 —— Tailwind 生成不出这个类且静默不报错，`QUEUED` / `PENDING` / `DRAFT` 三个状态因此渲染成**无色**。本次补齐 `--color-warning-strong` / `--color-danger-strong` / `--color-info-strong` 的浅色与深色两态取值。

- **P1 棘轮首批：`studio/logs/` 与 `studio/workflow-library/` 两目录清零**：44 处手写 `<button>` 换成语义变体，棘轮基线 458 → 414。空态、翻页、筛选、复制等按钮不再自带一套配色。

- **`ui/button.test.tsx`**（19 条）：逐个钉住 8 支变体存在、产出的类名不含任何 Tailwind 原生调色板字面量、软底变体的文字走 `-strong`、既有 6 个变体仍在。变体被删或改回写死色，这里先失败。
