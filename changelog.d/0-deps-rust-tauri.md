## Changed

- **`src-tauri/Cargo.toml` 的 Tauri 声明对齐到实际构建所用的版本**：`tauri` `"2.11.3"` →
  `"2.11.6"`，`windows` `"0.61"` → `"0.62"`（两条都是 `[dependencies]` /
  `[target.'cfg(windows)'.dependencies]` 里的声明下限）。

  **`src-tauri/Cargo.lock` 按仓库约定不入库**（`.gitignore` 第 107–109 行：「Tauri 构建产物，
  本地 `cargo build` / `build-desktop.mjs` 后生成」），所以「这次到底升了哪几版」不是由
  锁文件承载的 —— 每个检出在构建时按声明范围现解析。本次 `cargo update` 实测会把 17 个
  crate 抬到范围内最新（`tauri` 2.11.5 → 2.11.6、`tauri-plugin-updater` 2.11.0 → **2.12.0**、
  `tauri-plugin-log` 2.9.1 → 2.9.2，以及 `rustls` / `rustix` / `syn` / `cc` / `camino` 等传递依赖），
  这部分**随构建自动发生**，无需入库。真正需要写进仓库的是声明下限：`tauri` 的 `"2.11.3"`
  此前落后于构建实际用到的 2.11.6，`windows` 的 `"0.61"` 则把整条 0.62 线挡在门外。

- **为什么不改 `rust-version`**：该字段现在是 `1.77.2`。实测 `tauri` / `tauri-build` /
  `tauri-plugin-{log,process,updater,window-state,shell}` 各自声明的 MSRV **全部是
  `1.77.2`** —— 本项目的这个值是与上游一致，而不是「落后」（本机 rustc 是 1.98.0，
  但那是开发机装得新）。抬高它会让本仓库要求比它的依赖更高的工具链，属于**策略变更**
  而不是升级，因此不在本批内顺手改。`edition = "2021"` → 2024 同理（那是代码语义变更，
  与依赖升级不是一件事）。
