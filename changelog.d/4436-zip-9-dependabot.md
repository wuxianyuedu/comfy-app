## Fixed

- Dependabot 对 `src-tauri/Cargo.lock` 报的 3 条 `rust/zip` 告警清零（#4436）：critical GHSA-m665-v7pm-7grj（影响 ≤9.0.4）、high GHSA-q7v9-x93c-xqv3（<9.0.0）、medium GHSA-8hxf-qr8p-62x4（<9.0.0），首个修复版均 9.0.5+。`zip` 不是直接依赖，链路是 `tauri-plugin-updater` → `zip`；crates.io 实测 2.14.1 起把 zip 要求从 `^4` 提到 `^9`（且只要求 tauri `^2.12`，本仓 2.12.5 满足），故把 `tauri-plugin-updater` 2.14.0 → 2.14.1——manifest 的 `"2.13"` 约束原本就放行，manifest 一字不改；`zip` 随之解析到 9.7.2，三条告警的影响区间全部退出。`cargo check --locked` 与 `cargo test --locked`（壳内 80 条单测）全绿。
