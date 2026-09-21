## Fixed

构建脚本（build-tauri-release.ps1 / build-standalone.ps1）现在会回显实际执行的外部命令（如 `cargo build --release --features custom-protocol`、`pnpm tauri build --no-bundle`）。此前双击入口只回显启动命令，内层 cargo/pnpm 命令只透传输出、不回显命令行本身，看起来「只看到启动命令、不知道执行了哪些命令」。

同时修正 build-tauri-release.ps1 结尾把「完整发布构建」误指向 build-all.ps1（自身，单步壳构建）的注释，改为指向 build-standalone.ps1（完整生产构建：前端一并打包、双击即独立运行、不连 dev server）。
