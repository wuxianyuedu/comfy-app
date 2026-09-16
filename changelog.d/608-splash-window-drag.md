## Fixed

- **启动界面拖不动**：启动页窗口关了原生装饰（`decorations: false`），拖拽区只能自己声明，而此前只做了一半 —— ①只有标题行那一条可拖（十几像素高、右侧还被按钮占掉），按到窗口其余任何地方都不动；②启动页来自内嵌本地源，却没有 `core:window:allow-start-dragging`（`core:default` **不含**这条），窗口侧发起的拖拽被 ACL 静默拒绝，表现同样是「按住不动」。现在拖拽由页面脚本统一接管：`pointerdown` 落点不在交互件上就调 `startDragging()`，于是整窗（含内边距）都能拖；窗口按钮 / 查看日志 / 日志面板用同一口径排除（日志面板排除是为了保住文本选中复制），并补上 `capabilities/splash.json` 的拖拽权限。改的是 `public/splash.html`（三份副本）与 `src-tauri/capabilities/splash.json`，**必须重编壳**：`cd src-tauri && cargo build --release --features custom-protocol`。
