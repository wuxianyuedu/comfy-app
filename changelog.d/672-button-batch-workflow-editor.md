## Changed

- **P1 按钮分批第三批：`studio/workflow-editor/` 清零** —— 14 处手写 `<button>` + 2 处自写 spinner，棘轮基线 291 → 271（`scripts/.ui-primitives-baseline.json`）。

  落点是顶栏（`WorkflowEditorTopbar.tsx` 11 处：面包屑返回箭头 / 两级 crumb / 「返回上一级」/「强制重载」/ 调试 / 编辑 IO / 预览 IO / 查看 JSON / 重置布局 / 保存）、错误态的「返回」与子图提示的「×」（`WorkflowEditorInner.tsx`）、参数卡的「恢复默认」圆钮（`WorkflowParamCard.tsx`）。两处自写 spinner 改走 `ui/page-loading`。

- **两条口径写进规范 §16.2.4.2**（第 4、5 条）：

  4. **基元的默认类「排在后面胜出」，覆盖必须成套** —— `cn()` 把 `buttonVariants(...)` 排在调用处 `className` 之前，基元里没写的那几档（`bg-transparent` 起始底色、`rounded-none`）会漏过去。`topBarButtonClass` 的每个 tone 现在显式带齐 `h-auto rounded-none bg-transparent px-0`。
  5. **颜色字面量随转换一并收口** —— 顶栏与画布残留的 `violet-*` / `amber-*` / `sky-*` / `rose-*` / `red-*` / `emerald-*` 全部换成 `primary-*` / `warning-*` / `info-*` / `destructive` / `success-*` 语义类名（§3.6.2）。

## Fixed

- **`check-ui-primitives.cjs` 的 P1/P2/P3 先剥注释再计数**。判据原来直接数原始文本里的 `<button`，于是「原来是 `<button>` 手搓，现改走 `<Button>`」这类**说明性注释**被当成实现计上 —— 该文件的计数停在原地，棘轮永远降不下去（同款教训见 `check-theme-colors.cjs`：注释里的 `#346` 被误判成 3 位色值）。剥离后 P1 立刻多降 2 处（`studio/RequiredSummary.tsx` 与顶栏配置模块），并补了 3 条契约测试（注释不计 / 代码与字符串字面量仍计 / 跨行块注释不漏剥）。**字符串与模板字面量不剥离** —— `"<button"` 同样是「自己实现一份」的信号。
