## Changed

- 画布侧栏（use-sidebar-projects）与作品库（use-works-gallery）对结构性事件（hydrate / delete / delete-remote / draft）的并集取数做短 TTL 合并：同一拍事件不再两路各发一次 `project.list`（全列、上限 500 行），2s 窗口内第二路复用同一在飞请求，出窗才重新取。只合并事件触发那一跳；手动 `refresh()` / 挂载首拉 / 动作后强刷不带标记、永远拿新鲜读数。（#4678，#4600 未做的第三条）
