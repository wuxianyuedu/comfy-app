## Fixed

- 应用内右键菜单：菜单自身的 pointerdown 不再触发「下一次 pointerdown 即收起」。
  此前菜单项的动作挂在 onClick 上，而真实浏览器事件序是 pointerdown → … →
  click——pointerdown 里把菜单卸了，click 派发时按钮已不在 DOM，「刷新页面 /
  后退 / 前进」三个菜单项永远点不到（菜单作为功能整体失效）。菜单外部的
  pointerdown 与失焦仍照旧收起。（#4417）
