## Added

- **只想跑测试时不再被迫连 typecheck / eslint 一起跑**：新增双击入口 `tools/start/run-tests.ps1`（逻辑 `scripts/run-tests.ps1`），补上「工具目录里没有单独跑 vitest 的地方」这个缺口。它支持指定单个测试文件、`-Full` 连已知基线失败文件一起跑（用于复现基线失败）、以及透传 vitest 自己的参数（`--` 前后一视同仁），指定了文件时不再追加排除项。原有一键门禁 `verify-quality.ps1` 是三项固定串联、`-Mode test` 强制排除基线失败文件，日常改一处代码想只跑一个文件时并不好用。
