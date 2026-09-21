## Fixed

`build-tauri-release.ps1` 同步启动页资源改为「内容相同不写盘」（与 `scripts/launcher-core/splash-assets.mjs`、`src-tauri/build.rs` 同判据）。原先无条件 `Copy-Item -Force` 每次构建都会刷新 `src-tauri/splash-assets/*.html` 的 mtime，而 `/api/update-check` 的脏检测指纹只看 mtime+size（无内容 hash），导致运行中的会话在每次构建后误报「检测到本地更新，需重编壳」。
