## Fixed

- **品牌色/状态色不再写死，改一次 token 真的全站生效（规范 03 §3.6.2）**：`--color-primary: #7c5cfc` 早就定义好了，但 `studio/ui/ModalDialog.tsx` 写死 `violet-500/600` 6 处、`ui/status-badge.tsx` 写死 44 处 `emerald/violet/amber/red`、`ui/page-loading.tsx` 写死 `border-violet-500` —— 把 primary 改成蓝色，这些最显眼的状态指示与转圈仍是紫的。现在 `globals.css` 补齐 `--color-primary-strong` / `-500` / `-600` / `--color-aurora-*` 语义 token，`status-badge`（12 个状态）与 `page-loading`、`ModalDialog`、设置页四处 `accent-[var(--primary,…)]` 全部改走 token 类名。

## Changed

- **四处各抄一份的极光晕收成一个原语**：登录页 / 首页 / `FilmStudio` / `TrainingStudio` 各自内联 `radial-gradient`，色相相同强度却不同（0.48 / 0.42 / 0.40）。抽出 `AuroraGlow`（`tone` 选色相走 token、`alpha` 定强度），四处改用它 —— 与规范 03 §3.5「AuroraBackground 模式」是同一条要求。
- **顺手修掉 7 处 `var(--primary, #7c5cff)` 的坏写法**：变量名写错（`--primary` 只在 `:root`，不在 `@theme`，且该 fallback 从未生效），且正是扫描器报「写死色值」的来源；改成 `accent-primary` / `bg-primary/15` 这类语义类名后这 7 处不再是写死色值。主题色棘轮基线随治理收紧 167 → 142 处。
