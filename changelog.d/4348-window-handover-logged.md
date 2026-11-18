## Fixed

- **壳（Rust）：窗口交接的 close/navigate 失败不再被 `let _` 吞掉**（#4348）。
  交接成功后的 `splash.close()` 偶发失败（窗口正在销毁 / WebView 忙）原先被
  静默吞掉——启动页可能残留在屏幕上，splash 相关看门狗与安全网继续空转；
  `open_comfyui_window` 里地址变化后的重新导航失败同样被吞，用户停在旧页且
  无任何提示。现在：关启动页收成 `close_splash_window`（失败记 WARN + 就地
  重试一次，两次都败 ERROR 留痕，不因关页失败反过来中止交接），三处调用点
  统一走它；两处导航失败各补一条 WARN 读数。
