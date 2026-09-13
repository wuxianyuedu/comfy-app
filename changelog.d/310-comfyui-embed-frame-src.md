## Fixed

- **「多页签」方式打开 ComfyUI 显示 Edge「已阻止此内容」**（跨源 iframe 被拒渲染，ISSUE #310）：拦下它的既不是 ComfyUI 响应头（`--enable-cors-header` 后服务端完全放行），也不是 WebView2 的壳参数，而是**应用页自己的 CSP**——`next.config.js` 的 CSP 没有 `frame-src`，回退到 `default-src 'self'` 后跨端口（:3100 → :8188）即被嵌入方拒绝。已在 CSP 中加 `frame-src 'self' http://127.0.0.1:* http://localhost:*`（与 tauri.conf.json 同口径；`frame-ancestors 'none'` 反点击劫持不变）。
  同时移除两条实证无效的旧路径：exe 同级 `app.exe.manifest` 的 `per_app_arguments`（非 WebView2 官方机制，参数到不了浏览器进程，且会被 `build-launcher` 清空 `start-tauri/` 时抹掉）；`--disable-web-security` 壳参数方案（即便下发成功也豁免不了嵌入方 CSP，反而拆掉壳内页面隔离）。改的是 `next.config.js`，dev server 重启后生效（双击启动链路会自动重启）。
