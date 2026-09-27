## Changed

- `scripts/check-ui-primitives.cjs`：P81「视图层 `<Button>` 直接子 icon 缺 `data-icon`」从棘轮升为硬闸（`HARD_GATE_RULES` 加 `"P81"`），与 P70/P72/P73/P75/P76/P77/P78/P79/P80 同批。视图层新增 `<Button>` 直接子级 icon-like 标签（`Icon` / `svg` / `*Icon` 后缀 / lucide 白名单）不带 `data-icon=` 直接阻断。
- `scripts/.ui-primitives-baseline.json` 由 `--update` 重刷：P81 从 `rules` 表移除（硬闸不进基线），`total` 保持 0。

引入 → 治理 → 升硬闸的完整节奏（对齐 MEMORY 记录的「加棘轮完整节奏」）：#1108 引入 · 冻结 114 处 → #1116 一次治理清零（脚本按块扫直接子级 icon-like 标签注入 `data-icon="inline-start"`）→ 本 PR 升硬闸。
