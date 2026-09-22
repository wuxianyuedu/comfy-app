## Changed

- **`src/components/studio/logs/log-store.ts` 拆包**：1557 行超过 §12.6 文件长度
  棘轮的阈值（--strict 违规，比基线多 1）。切成三块、依赖方向**完全单向**：
  · **`log-types.ts`**（87 行，叶子）—— `LogLevel` / `LogEntry` / `LogFilter`
  / `LogOriginFilter` / `CONSOLE_ORIGIN` / `bucketOf` / `LogLevelCounts` /
  `LogOriginCounts` / `LOG_PAGE_SIZE`；主文件与 `log-analysis` 共同 import
  它，`check-circular-deps` 不看 `import type` 就把环坐实的坑一并绕开；
  · **`log-analysis.ts`**（699 行）—— 采集 / 解析 / 过滤**一族纯函数**：
  `serialize` / `captureLocation` / 5 个噪音判据（`isReactQueryLog` /
  `isNoisyFrameworkLog` / `isNextDevNoise` / `isRoutineRpcTimingLog` /
  `isRoutineRpcTimingLine` / `isPanelSelfPollingLine`）→ `parseFileLogs` →
  `mergeTimeline` / `lastSeqOf` / `dropStaleEntries` / `dedupeRepeats` /
  `computeCounts` / `computeOriginCounts` / `computeFiltered` + ID/seq
  生成的窄封装。这一层**不吃 store state**，是天然叶子；
  · **`log-store.ts`**（832 行）—— 保留 Zustand store 本体（`useLogStore`、
  `LogStoreState`、`LogPanelSlice`、`derive` / `viewOf` / `applyView`、
  翻页 selector、readWatermark 与贴底基线）；`export * from "./log-types"`
  与 `export * from "./log-analysis"` 把两侧公开面透传出去，消费者
  `from "~/components/studio/logs/log-store"` 的路径**完全不变**（§12.18
  复用优先）。

  `scripts/.file-size-baseline.json` 里 `log-store.ts` 从 1557 降到 832；
  `scripts/.non-null-assertions-baseline.json` 里 3 处 `!`（`match[1]!` 与
  `lines[i]!` 一族）从 log-store 挪到 log-analysis，总数不变。
  `pnpm exec tsc --noEmit` 绿；`check-circular-deps` 无新增环；
  `src/components/studio/logs/**` **7 测试文件、241 用例**全过；
  `check-function-length` 与 `check-non-null-assertions` 两门绿。
