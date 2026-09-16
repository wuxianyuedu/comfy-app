## Fixed

- **应用内 ComfyUI 拖不进图片 / 工作流（浏览器整窗打开同一个地址却可以）**：应用级页签把 ComfyUI 以跨源 iframe 内嵌在 Tauri 主窗里，而桌面壳默认挂 WebView2 的**原生拖放处理器**——它一接手，Chromium 就不再走自己的拖放路径，`dragover` / `drop` 不派发到 DOM，ComfyUI 读不到 `dataTransfer.files`，于是拖进去毫无反应（同一个 ComfyUI 在浏览器里没有这层壳，所以照常可用）。现在主窗 builder 显式 `disable_drag_drop_handler()`：拖放交回 DOM，页签里的 ComfyUI（以及应用自身）恢复浏览器一致的拖入行为。本应用不消费原生文件拖放（页内拖放都是自定义 dataTransfer，壳侧也没有注册 `on_drag_drop`），关掉是纯收益。**需重编 Rust 壳**（`cargo build --release --features custom-protocol`），只改前端跑旧二进制等于没改。
