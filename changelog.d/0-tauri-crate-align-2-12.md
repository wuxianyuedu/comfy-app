## Changed

- `src-tauri/Cargo.toml`：壳侧 Tauri 依赖对齐 npm 侧 —— `tauri 2.11.6 → 2.12`、
  `tauri-plugin-process 2 → 2.4`、`tauri-plugin-updater 2 → 2.13`。
  这三对是 `tauri build` 开头版本自检逐对判的（要求同 major/minor，错配直接 `Error` 退出，
  且没有跳过旗标）。此前 npm 侧已经到 `@tauri-apps/api 2.12.1` / `plugin-process 2.4.0` /
  `plugin-updater 2.13.1`，而 crate 停在 `7916814e` 那次「声明对齐实际构建版本」时的 2.11.6，
  于是**打安装包这条路（规范 §7 生产构建行的 `pnpm tauri build`）一进自检就秒退**。
  日常发布走的是 `cargo build --release --features custom-protocol`（不跑这道自检），
  所以这份错配一直没被看见。
  验证：`cargo build --release --features custom-protocol` 通过，
  `cargo test --release --features custom-protocol` 53 passed / 0 failed。
