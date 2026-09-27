## Fixed

- **`LlmLocalSection.tsx:153` 「工坊候选模型」chip 从 `<Button aria-pressed>` 迁 `<Toggle>`**
  （P77 六批 · 累计 1 → **0**）：
  每个候选模型 chip 是**独立开关**（当前模型永远 checked · 其它候选独立勾选、
  不构成 2-7 项互斥选项组）。之前评估需要"扩 ToggleGroup 支持永远-pressed
  项"是**过度设计**——正解是每项独立 `<Toggle>`（single-toggle 语义、非组），
  `pressed` / `onPressedChange` 与旧的 `aria-pressed` / `onClick` 一一对应。
  `size="xs"` 走 `size="sm"`（Toggle 只有 default/sm/lg）、`variant="ghost"`
  走 default（`data-[pressed]:bg-muted` 由基元统一）。视觉走基元档、用户口径
  「允许漂移」。

## Changed

- **P77 从棘轮升为硬闸**（加进 `HARD_GATE_RULES`）：#1007 引入时视图层实测
  7 处，六批治理（#1034 #1051 #1054 + 本 PR）清零 → 升硬闸。视图层新增
  手写 `aria-pressed=` 直接阻断。
- **P78 从棘轮升为硬闸**（同时加进 `HARD_GATE_RULES`）：#1006 引入时视图层
  实测 33 处，十批治理（#1030 #1032 #1035 #1038 #1040 #1047 #1089 #1092）
  清零 → 升硬闸。视图层新增裸 `<label>` 直接阻断、走 FieldLabel/FormField/
  `<div role="option">`。

**至此 shadcn 严格治理会话新立的 6 条判据全部升为硬闸**：
- P72（模态可访问名）· P76（`<select>` → SelectMenu）· P77（`aria-pressed`
  → Toggle/ToggleGroup）· P78（`<label>` → FieldLabel/FormField）·
  P79（原色板 → 语义 token 或 p71-allow）· P80（`w-N h-N` → `size-N`）

新增视图层违反这些 shadcn 规则**直接阻断提交**、不再进基线。

## 基线

`scripts/.ui-primitives-baseline.json` **total: 0**（`files: {}`）。
