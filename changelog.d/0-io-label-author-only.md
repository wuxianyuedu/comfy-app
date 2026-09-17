## Changed

- `WorkflowIOEntry.label` 语义收窄为**作者在 IO 面板里的改名**：勾选 IO 不再把
  画布上的显示名抄进库（连 `IoRef` 的 `label` 字段一起去掉），显示名只在前端一处
  算 —— 作者改名 → 富化链（raw 的 label → 子图内部业务名 → localized → pin 名）。
- ISSUE #349 那套「机器名让位 / 清洗」机制整体删除：`isMachineName` /
  `isWrapperAliasName` / `isStaleExposedAlias` / `HOMONYM_LABEL_SUFFIX`、store 里的
  `aliasBaseByKey` / `setAliasBase` / `purgeMachineNames`、编辑器里两个兜底 effect、
  服务端富化的 `staleAlias`，以及只为这套判定下发的 `enrichedLabel`（`slotLabel`
  保留为事实字段）。根因（抄名字进库）一去掉，这些补丁就没有存在理由。
- 连带效果：库里存量 label 现在按「作者命名」直读 —— 旧版抄下来的名字会一直显示，
  直到作者在面板里清空改名（✎ 框留空即回到富化名）。`setIOLabel` 写什么存什么，
  把参数改名成与 pin 名逐字相同也不会被改写。
- 显示名一致性的保证方式从「抄一份 + 让位」换成「同一个来源」：画布行、IO 面板、
  运行表单都读同一条富化链，不再需要跨层对齐。
