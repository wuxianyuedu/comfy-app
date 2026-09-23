## Added

- **完成状态收敛为 ProductionProgress 单一持久来源（Phase 4 / 设计 §7）**：新增 `src/lib/production/progress.ts`——持久侧的阶段词表 `ProductionStage` 与 `ProductionProgress`（阶段游标 + `rendered`）、`normalizeProductionProgress`、`DEFAULT_PRODUCTION_PROGRESS` 都在这一定义一次。`production` 行的 `progress` JSON 列成为两侧共读的那一份，`ProductionPayload.progress` 与 `buildProductionPayload` 都收紧到该类型（视图层 `stage-config` 的 `Tab` 与之结构同构，读回的 `stage` 经 normalize 已夹在该集合内，故不反向把 lib 枚举引入视图层）。

## Fixed

- **工坊 `rendered` 刷新即丢**：`rendered` 与阶段游标此前只是 React state，切页签 / 重挂载 / 刷新都回落默认（`false` / `script`）。`production-client` 加共用读 `fetchProductionProgress`，工坊挂载时从持久化的 `production.progress` 恢复 `rendered`（并在用户尚未导航、`tab` 仍是默认 `script` 时一并恢复阶段游标），作废守卫用 `beginStaleRun`（规范 16 §16.2.4.34）、卸载即 `dispose`、结论不落地。

## 范围说明

本 PR 只做 §7 的数据/状态层地基（单一来源 + 持久 + 恢复 + 两侧共用读取入口），不改任何视图布局。设计 §7 点名的另外两处状态源（`filmProject.status/progress`、`workshopSession.stage`）向 `ProductionProgress` 的收敛、以及「画布顶栏展示同一份进度」的 UI，作为后续独立项推进（画布是全幅 ReactFlow、当前无顶栏进度条，补该展示需要单独的 UI 设计）。
