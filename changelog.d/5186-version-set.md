## Added
- `pnpm version:set <MAJOR.MINOR.PATCH> [--check]`（#5186）：一次写 package.json / tauri.conf.json / Cargo.toml 三处版本号并逐文件独立回读；`--check` 调既有守卫的 `--report`，是否该升仍由人判断。
