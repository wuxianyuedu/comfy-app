## Fixed

- GA 每日档「API 文档生成与自检」连红两跑（#4407）：typedoc 报「referenced …
  but not included / resolved but is not included」共 4 处（Ga 上当时的 3 处 +
  其后提交又引入 1 处 `HeavyTaskColumns`），按 #2444 口径 warning 即红。
  四个符号都已在公开签名里被引用（`TaskCardRow` 的 Omit 键、`Ctx.db`、
  `ensureProductionProject.executor`、`pruneTempWorkflowFiles.maxAgeMs` 缺省值），
  按 #2835 先例补 `export`（级联出 1 处：`HeavyTaskColumns` 从
  `HEAVY_TASK_COLUMNS` 派生，同口径一并导出），并在每个符号的注释里写明
  「为什么必须导出」，防「没被外部消费的导出」被下一次清理收掉后同格再红。
  修后当场读数：`pnpm docs:check` EXIT 0（0 errors / 0 warnings，3257 份产物
  438 个模块页）；`check-dead-exports` 0 命中；tsc / oxlint 全绿。
