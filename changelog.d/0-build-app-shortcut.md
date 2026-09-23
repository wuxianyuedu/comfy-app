## Added

- **构建 release 壳后在仓库根生成启动快捷方式**：`tools/scripts/build-tauri-release.ps1` 构建成功后，自动在仓库根创建 `Comfy APP.lnk`（指向 `src-tauri/target/release/app.exe`，工作目录设为项目根），双击即可启动、省去每次去 `target/release` 里翻。另新增独立脚本 `tools/start/Create-AppShortcut.ps1`，手动 `cargo build --release --features custom-protocol` 之后也能单独运行补生成。快捷方式（`*.lnk`）已加入 `.gitignore`，不入库。
