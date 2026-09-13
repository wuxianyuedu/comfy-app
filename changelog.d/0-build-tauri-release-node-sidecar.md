## Fixed

- **一键发布构建开局报 `resource path binaries\node-x86_64-pc-windows-msvc.exe doesn't exist`**：`tauri.conf.json` 声明的 `bundle.externalBin` 在每次 cargo build 编译期都被 tauri-build 校验，而 sidecar 所在的 `src-tauri/binaries/` 不入库，`build-tauri-release.ps1` 又只增量同步 splash 不跑 `build-desktop.mjs`，全新克隆 / 清理过该目录的机器必现编译失败。现在 `build-tauri-release.ps1` 编译前检测 sidecar 缺失即从当前 Node 运行时复制补齐（PATH 无 node 时给明确报错）。
