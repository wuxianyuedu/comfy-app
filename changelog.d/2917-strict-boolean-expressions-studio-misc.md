## Changed

- **oxlint `typescript/strict-boolean-expressions` 批 13：
  `src/components/studio` 小目录合并清零（50 处 / 23 份）**（ISSUE #2776 /
  #2917）：history 24 处/9 份（HistoryDetailModal 5、HistoryTaskCard 2、
  ImageRedrawPanel 3、MaskCanvas 3、history-detail-derive 1 + 其测试 1、
  hooks/use-history-detail-actions 2、hooks/use-history-list 3、
  hooks/use-image-redraw 3 等）、hooks 19 处/8 份（use-comfy-readiness 1、
  use-css-color-token 4、use-film-studio 5、use-model-folder-config.test 4、
  use-model-library.test 2、use-model-tags 1、use-project-outputs 1、
  use-workspace-tabs 1）、queue 3 处/3 份、library 2 处/1 份、
  works 1 处/1 份、debug 1 处/1 份。
  - 口径与前几批一致：可空布尔/可选链布尔 → `=== true`（否定 `!== true`）；
    `string | null` → `!== null && !== ""`；`string | undefined` →
    `!== undefined && !== ""`；`unknown` / 恒真对象防御真值 → `Boolean(x)`；
    nullable number 的 `!total`（含 NaN 语义）→
    `=== undefined || Number.isNaN(x) || x <= 0`；noUncheckedIndexedAccess
    下标取值按 `T | undefined` 处理。
  - 批 14 全量 tsc 复核时发现本批一处收窄回归
    （use-history-detail-actions 的 `!Boolean(result?.workflow)` 不让 TS
    收窄 `result`），已改写为
    `result === null || !Boolean(result.workflow)`（逐值等价，运行时防御
    保留），随本批口径一并记录。
  - 验证：各小目录改完立即重拉复核 0 残留；vitest 就近跑 history 45 绿、
    hooks 103 绿、queue/library/works/debug 124 绿。
  - 剩余总量见批 14 收尾后的 `log/tools/sbe-remaining-2026-11-02.md`
    （416 处 / 173 份）。
