## Fixed
- JSON 查看器高亮导航的全量 DOM 重建（ISSUE #5229 F3）：命中跳转（Enter / 上一个 / 下一个）此前每次都重跑整棵子树 `querySelectorAll` ×2 + `normalize()` + TreeWalker 全扫 + 逐 textNode 拆 `<mark>`，大输出里每按一次键都是一次主线程长任务。改为只在搜索词 / 数据变化时重建高亮 `<mark>` 并按注入顺序缓存，命中导航只切换两个节点的 active 属性（O(1)），顺带修掉重建与 active 设定的竞态（合并到同一帧调度）。补一条用例钉住「跳转只改属性、不重建 `<mark>` 子树」；F1/F2/F4/F5 逐处核对后确认无新增可改项（见 ISSUE #5229 回帖）。
