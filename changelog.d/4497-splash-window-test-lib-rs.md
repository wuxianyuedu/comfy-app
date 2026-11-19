## Fixed

- `tests/check-file-structure.test.ts` 的 `splashWindow()` 改读 lib.rs 的程序化建窗真值源（`SPLASH_WINDOW_SIZE` 常量 + builder 链的 `.inner_size(...)` / `.decorations(false)`），并清掉失效的 `isSplashConfig` / `SplashWindowConf` / `CONF`（#4497）。根因：#4440 把 splash 窗口改成壳内程序化创建后 `tauri.conf.json` 不再声明窗口表，而这组判据还在读旧位置——「固定结构用例」对任何新树恒红（3 条启动页用例全红），挡住所有在途 PR。修法只动测试取数位置，断言意图一字未改。
