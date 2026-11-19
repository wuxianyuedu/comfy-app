## Fixed

- **Run 引擎内容列并发写回加锁（#3932 / #3850）**：`execScript` / `execCharacters` / `execStoryboard` 在 LLM/推导完成后，将 `scriptMarkdown` / `characters` / `shots` 的 `patchContent` 写回统一纳入 `withProductionContentLock(projectId)` 串行化（慢 IO 仍在锁外），与既有生图回写/评审重出路径一致，降低并发覆盖导致的丢失更新风险。
