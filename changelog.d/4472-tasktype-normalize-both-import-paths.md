## Fixed

- **本地文件导入与粘贴 JSON 导入的 taskType 归一口径一致**（#4472）：
  两条入口现在共用同一份 `resolveImportedTaskType` 出口——`defaultMode` /
  文件识别结果一律过 `normalizeTaskType`，未知自定义码同走一条「放行自定义」
  日志。此前本地分支把 `defaultMode` 原样落库、粘贴分支才归一，同一工作流走
  不同入口落库的 taskType 不一致（`fl2v` vs `FLF2V`）。
