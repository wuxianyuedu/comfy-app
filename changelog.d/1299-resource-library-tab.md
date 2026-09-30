## Added

- **「资源库」提成项目界面的一级页签**（画布 / 工坊 / 资源库 / 产出 / 成片）。此前它只是工坊右栏里的一张计数卡，末尾那句「参考图、音效等素材在画布的素材库导入与管理，这里只做汇总展示」等于自己承认它不是真身 —— 想找素材仍得先回画布抽屉。
  - 新视图 `components/studio/library/ResourceLibrary.tsx` + 逻辑层 `hooks/use-resource-library.ts`（`NavItems.tsx` 注册 `library`，`workspace/page.tsx` 懒加载接入）。
  - **不重造第二套网络层**：数据与动作直接复用画布素材库的 `useMaterialLibrary` / `materials-client`，结果区就是同一个 `MaterialLibraryContent`（本次只给它加了可传列数的两个 class 参数，画布抽屉传默认值、行为不变）。改一处网格 / 空态 / 骨架两边同时生效。
  - 整页形态相比 360px 抽屉多出来的部分：作用域档带总数、上传入口在页头、断点列数（2 / 3 / 5 列）、没有活跃项目时的引导态。
  - 工坊右栏那张卡保留计数（它回答的是「这一步的材料够不够」），正文说明换成「在资源库中打开 →」，经新增的 `workspace:navigate` 应用事件跳转 —— 触发方与持有视图状态的容器之间隔了两层，为一条链接穿三层 props 不划算。

## Tests

- 新增 `ResourceLibrary.test.tsx`（页头 / 分类渲染 / 作用域档 / 无项目引导）与 `use-resource-library.test.ts`（计数汇总 / 作用域切换的查询串 / 无活跃项目）。
- 更新 `nav-items.test.ts` 与 `ProjectTabBar.test.tsx` 的页签清单（四处 → 五处）。
