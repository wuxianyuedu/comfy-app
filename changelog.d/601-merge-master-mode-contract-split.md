## Fixed

- **`fix/596-exposed-param-labels` 合并 master 时的冲突收口**：master 把「模式契约」拆成两个入口（`components/workshop/mode-contract/**`，契约注册表 hook 与 `effectiveModeContract` 一并迁走），与本次「对外参数名收口到单一出处」在同一处汇合。解冲突时保留双方语义 —— 契约口清单仍统一由 `modeContractEntries` 产出（两个页签共读同一份），注册表读取与「改过 / 没改过」判据走 master 的 `effectiveModeContract` / `~/components/workshop/mode-contract/hooks/use-mode-contracts`；`WorkflowCanvasNodePreview` 及其两个用例里指向旧路径的 hook 引用同步改到新目录。
