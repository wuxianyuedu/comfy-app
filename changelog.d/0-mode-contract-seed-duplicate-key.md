## Fixed

- **模式契约预制口清单 `MODE_CONTRACT_INPUT_TYPES` 里 `seed` 被重复声明两次（回归）**：该清单此前在 #1172 合并冲突解决时已收成 8 项，但当前分支又出现两份相同的 `{ type: "seed", ... }`（连注释都复制了两遍），导致 `mode-contract-config.ts` 的 `contractInputCatalog` 经此清单派生时产出两个 `type === "seed"` 的口，渲染组件用 `key={item.type}` 即报 React「two children with the same key, seed」。删掉重复的一份，恢复 prompt / negative / size / duration / seed / reference-image / first-frame / last-frame 共 8 项。
