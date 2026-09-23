## Fixed

- **启动页 WebView2 未生效时，壳不再把主窗留在 `about:blank`（表现为「没有任务栏图标 + 托盘唤起白屏」）**：现场是 WebView2 建启动页 webview 失败（`HRESULT(0x80070057)「参数错误」`），内嵌资源与窗口对象都在（`splash.html embedded: true`），但启动页的页面 JS 从不执行 → 没人调 `navigate_to_app` → 隐藏的主窗一直停在 `about:blank`（主窗建窗即 `visible(false)`，从未显示过就没有任务栏图标；托盘「打开主界面」显示的就是这个空白页）。原先的兜底判据只看「`splash.html` 有没有嵌进二进制」（`has_splash`），看不见「资源在、WebView 没起来」这一形态，看门狗也只是 `base url not seen in 5s, giving up` 后返回。

  现将判据改为「**启动页能不能真的跑起来**」：`src-tauri/src/lib.rs` 新增唯一兜底 `fallback_without_splash()`，看门狗拿不到启动页基准 URL 时不再干等，改走与「资源缺失」同一条路（等应用端口就绪 → 导航主窗 → 显示主窗 → 关掉启动页）。判据见 `window_startup_tests::unavailable_splash_falls_back_to_navigate_when_ready`；改 `src-tauri/src/**` 后必须重编壳（`cd src-tauri && cargo build --release --features custom-protocol`）。快速重启（上一次实例刚退出几秒内又启动）是 WebView2 建窗失败的高发窗口，遇到时按唯一入口重来一次即可。
