## Changed

- `scripts/check-ui-primitives.cjs`：P75「视图层手搓空态卡」从棘轮升为硬闸（`HARD_GATE_RULES` 加 `"P75"`），与 P70/P72/P73/P76/P77/P78/P79/P80 同批。视图层新增 `border-dashed + rounded-(xl|2xl|3xl) + 内文案` 的自绘空态卡直接阻断，走 `~/components/ui/empty-state` 的 `<EmptyState>` 或 `~/components/ui/empty` 的 `<Empty>` 基元。
- `scripts/.ui-primitives-baseline.json` 由 `--update` 重刷：P75 从 `rules` 表移除（硬闸不进基线），`total` 保持 0。

引入 → 治理 → 升硬闸的完整节奏（对齐 MEMORY 记录的「棘轮完整节奏」）：#1102 引入 · 冻结 12 处 → #1103 workshop 6 处迁 `hint` → #1104 studio / model 6 处迁 `page` → 本 PR 升硬闸。
