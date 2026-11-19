## Fixed

- `pr-gate.yml` 的「恢复 node_modules 缓存（灰度）」从 `actions/cache@v4` 升到 `@v6`（#4483）：对齐文件头的 `uses:` 版本口径（最新主版本，`git ls-remote --tags` 核过 v6.1.0），消 node20 运行时移除后旧主版本被强迁 node24 的弃用告警；与 `package-desktop.yml` 的 NSIS 缓存同版。`path` / `key` 输入面无变化，缓存键与命中语义不变。
