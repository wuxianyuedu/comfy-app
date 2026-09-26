## Fixed

- **`<Hint>` 把 `A-` / `A+` 两枚字号按钮的可访问名盖掉了**（`ResultCard.tsx`）。迁移时按「可见内容只有 2 个字符、又不是中文」判成图标字形、补了 `accessibleName` → `aria-label="字号减小"` 覆盖了屏幕上写的「A-」。带**字母或数字**的就是可见文字（`A-`、`5×`、「错误」），名字该由文字自己给，另写一份会撞 WCAG 2.5.3「label in name」—— 语音控制用户念屏幕上那个词就点不到。去掉这两处的 `accessibleName`，并把这条界线写进 `ui/hint.tsx` 的文档注释（纯字形 `✕ ⋮ ↶ ●` 才补名）。全库反查：带字母/数字而误补名的只有这两处。
- **`WorkflowEditorTopbar.test.tsx` 那条「每个按钮都带 `data-slot=button`」的用例**：被 `<Hint>` 包的按钮，`data-slot` 会被 Base UI 的 trigger 接管成 `tooltip-trigger`（同一个属性写两遍，trigger 侧后施加覆盖），于是「加了悬停提示」被这条用例误读成「退回手写 `<button>`」。改判**基元自己的类**在不在（`buttonVariants` 的 `group/button`），而不是只认 `data-slot="button"`。
  同时确认过这不是视觉回归：全库没有任何样式或门禁按 `[data-slot=button]` 取元素（`ui/button-group` 用的是 `button-group` / `select-trigger` 两个别的名字），这个副作用只影响「按 data-slot 断言按钮身份」的写法 —— 已连同成因一起写进 `ui/hint.tsx` 的注释，免得下一个人再踩。
