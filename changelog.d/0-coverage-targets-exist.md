## Added

- **覆盖率配置的「查无此文件」判据**：新增固定清单用例 `tests/coverage-targets-exist.test.ts`，断言 `vitest.config.ts` 的 `coverage.include` 每一项与 `coverage.thresholds` 每一个键都能匹配到 `src/**` 下至少一个真实文件（口径按「键 ⇄ 磁盘」而不是「键 ⇄ 上次报告」——增量档那份报告只有 380 个文件，拿它当事实源会把「本次没跑到」误报成「配置悬空」；比之前先脱 gitignore 风格转义，避开 §11.7 那条 `\(main\)` 假红）。同时摘掉三条指向已删模块的条目：`src/server/api/routers/train.ts`（`include` 与一条 100/100/100/100 的档，随炼丹功能废弃）、`src/lib/comfyui/executor-scheduler.ts`（一条 70/70/70/50 的档，派发循环收成一条 pull 时删的）。这两处此前不会让任何判据变红 —— 68 份判据扫的是 `src/**`，配置文件本身不在任何一份的作用域里。反向验证过判据有牙：插入两条假路径后 include 与 thresholds 两档分别变红。
