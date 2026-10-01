## Added

- **顶栏一键光暗切换**（`TopBar` 里的太阳/月亮按钮，在搜索与消息入口之间）。走 `next-themes` 的 `setTheme`，与设置页外观分区同一个出口，不另造一份主题状态。
  - 为什么值得单独说一句：设置页外观分区**一直写着**「也可通过顶部导航栏的太阳/月亮按钮随时切换」，而全仓没有那个按钮 —— 界面在承诺一个不存在的控件。要么删掉承诺，要么把控件补上；选了后者，因为主题是最常用的单一开关，藏在一层导航之后不合理。
  - 读 `resolvedTheme` 而不是 `theme`：后者可能是 `"system"`，那样点一下只把值写成 system 而画面不动。
  - 两枚图标**同时渲染**、靠 `dark:` 变体决定谁可见。若按 `resolvedTheme` 条件渲染，服务端与首帧那个值是 `undefined`，按钮会在 hydration 之后跳一下。

## Tests

- 新增 2 条 jsdom 用例：点一下按当前档**反向**写回（不是固定写死某一档）、两枚图标同时存在于 DOM（钉住上一条 hydration 约束）。
- 新增 1 条浏览器用例（`e2e/theme-toggle.spec.ts`）：首帧按钮就在且有两枚图标 → 点一下 `<html>` 的 `dark` class 真的翻 → 再点一下**翻得回来**。jsdom 只能验到"调了 setTheme"，落到文档上这条链路（Provider / `suppressHydrationWarning` / CSS 变量回落）只有真浏览器能判。
- 负向验证：把切换实现改成写死 `setTheme("dark")` → 「按当前档反向翻」立刻红，复原复绿。
- 既有 `TopBar.test.tsx` 其余 4 条未改断言仍全绿。
