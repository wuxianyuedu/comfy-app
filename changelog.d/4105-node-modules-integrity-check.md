## Fixed

- 补强 `node_modules` 完整性自检：`RESOLVE_PROBES` 纳入 `pino`（ISSUE #4105），`checkNodeModules` / `check:toolchain` 与预检现在会把“已安装但声明依赖解析不到（包缺失、被清空或损坏）”判红并点名依赖，避免单包被外部清空后在 `tsc` / oxlint / premerge 才以 `Cannot find module` 或 inconclusive 退 2 现身。
