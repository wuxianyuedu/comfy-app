## Added
- `pnpm ci:attribute [sn] [--gate <标签>] [--file <测试文件>]`（#5182）：只编排既有执行者 —— `ship --diagnose` 取红格、`base-check` 取五态，仅超时指纹且点名文件时才隔离复跑同一份清单；不新增第六态、不改判据，明确「不许抬 testTimeout」。
