## Changed

- `scripts/check-ui-primitives.cjs`：P71「视图层手写 `dark:<palette>-N` 色」从棘轮升为硬闸（`HARD_GATE_RULES` 加 `"P71"`），与 P70/P72/P73/P75/P76/P77/P78/P79/P80/P81 同批。视图层新增 `dark:` 前缀的调色板色（`dark:bg-red-400` / `dark:text-amber-*` 等）直接阻断，走语义 token 或就地 `// p71-allow:start …` 声明例外块（ANSI SGR 8 色 / 品牌渐变端点 / 类别装饰色 · 与 P79 共享一份 allow）。
- `scripts/.ui-primitives-baseline.json` 由 `--update` 重刷：P71 从 `rules` 表移除（硬闸不进基线），`total` 保持 0。
- `tests/check-ui-primitives.test.ts` 三处跟上：
  - **P71 只计 p71-allow 块外**：改走 `--report`（只出清单不判失败）+ 解析 `[ui-primitives] P71 … —— N 处 / M 文件` 行的数字，等价锁住「计数与 allow 剥离生效」。
  - **--update 允许登记新判据起点**：载体从 P71 换到仍是棘轮的 P1（视图层裸 `<button>` · 基线 0），语义一致（"新判据起点登记允许、已有 rule 上升拒绝"）。
  - **P79 与 P71 分工**：两条硬闸的命中行形态是 `P71 → path（N 处）`、不是棘轮的「新增 Pxx」；断言改成 `toMatch(/P71\s*→/)` + `not.toMatch(/P79\s*→/)`。

引入 → 治理 → 升硬闸的完整节奏（对齐 MEMORY 记录的「加棘轮完整节奏」）：#1011 P71 引入 · 冻结 230 起点 → 数批治理（P79 治理批次里同时清 P71 · #1063~#1088）→ 清零 → 本 PR 升硬闸。
