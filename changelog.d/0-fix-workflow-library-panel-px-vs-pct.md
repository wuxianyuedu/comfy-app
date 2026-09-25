## Fixed

- **工作流库列表分栏被夹到 45px（issue #981）**：`WorkflowLibrary.tsx` 的
  `ResizablePanel` 尺寸写成了数值 `defaultSize={24}` / `minSize={16}` /
  `maxSize={45}` / `defaultSize={76}` / `minSize={40}`。但项目锁的是
  **react-resizable-panels v4**（v4.13.2），v4 改了语义——**数值 = 像素、字符串
  （无单位）= 百分比**（见 `node_modules/react-resizable-panels/dist/
react-resizable-panels.d.ts` 的 `PanelProps.defaultSize` 注释）。于是 v4 把
  `defaultSize={24}` 读成「24 像素」、`maxSize={45}` 读成「最大 45 像素」，列表
  被夹死在 45px（几乎只剩一条滚动条）。

  修法：三处尺寸全改字符串百分比 `defaultSize="24" minSize="16" maxSize="45"` /
  `defaultSize="76" minSize="40"`。引入方是 PR #960（按 v3 语义写的数值）。

## Tests

- `WorkflowLibraryLayout.test.tsx` 里「左右分栏」那条用例是 #960 重构后**遗留的
  陈旧断言**（还在查 `w-80 shrink-0 flex-col` / `min-w-0 flex-1 overflow-hidden`
  这些 #960 已删掉的旧固定宽布局字符串，自 #960 起就红、且不在 pre-commit 子集里
  所以没拦住）。本批改写为：钉死分栏走 v4 **字符串百分比**（`defaultSize="24"…`
  三处），并加**反向断言**「不再残留任何 `defaultSize={数字}` / `min|maxSize={数字}`
  数值形式」——把 #981 这个像素 bug 变成机器回归，防止有人再写回数值。同时把列表
  根断言更新为 #960 之后的 `w-full min-w-0 flex-col`（填满所属面板）。

## Notes

- 浏览器实测：dev 形态下工作流库列表分栏从 45px 恢复到 **346px**（视口 1699px、
  面板组占约 20%，因左侧导航栏另占 ~200px），列表条目 / 搜索框 / 「未载入的本地
  工作流」分组正常显示。
- 本仓库目前只有这一处用 `ResizablePanel`（grep 过），无其它同类数值写法。
