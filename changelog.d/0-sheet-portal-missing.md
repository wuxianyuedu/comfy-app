## Fixed

- **右侧抽屉（`ui/sheet`）一打开就把整页崩成「页面出错了」**：`SheetContent` 渲染了遮罩与基元 `Dialog.Popup`，却没有包在 `SheetPrimitive.Portal` 里。Base UI 与 Radix 不同 —— Radix 允许省略 Portal（Popup 直接内联渲染），Base UI 缺了会直接抛 `Base UI: <Dialog.Portal> is missing.`，把整棵组件树打崩：面板连同右上角关闭按钮一起消失。凡用到右侧抽屉的界面（移动端 `sidebar`、`ProjectOutputs`、项目画布 / 工作流画布设置）打开时都会中招。

  修法：给 `SheetContent` 补上 `SheetPrimitive.Portal`，与 `ui/dialog` 的 `DialogContent`、`ui/fullscreen-dialog` 对齐（那两处本来就有）；新增 `sheet.test.tsx` 在「打开抽屉」时渲染一遍，回归「Portal 缺失即崩」。
