## Changed

oxlint `eslint/unicode-bom` 全仓清零（#2775）：2 份 `.ts` 去掉文件头 UTF-8 BOM（`src/lib/comfyui/enqueue.ts`、`src/lib/comfyui/executor-cli.ts`）。

BOM 只在个别编辑器保存时被带入，对 TS 解析与运行无影响；仓库现行约定是无 BOM（`.ps1` 的 BOM 是另一条规则，不受此影响）。改动为 `--fix` 直接收敛，无手工补丁。
