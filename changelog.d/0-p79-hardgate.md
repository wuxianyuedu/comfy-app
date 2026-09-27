## Changed

- **P79 从棘轮升为硬闸**（加进 `HARD_GATE_RULES` · `scripts/check-ui-primitives.cjs`）：
  #1009 引入时视图层实测 **67 处** 无 `dark:` 前缀的浅色原色板，八批治理
  （#1065 #1066 #1073 #1076 #1079 #1082 #1085 #1087 · 覆盖 38 文件）
  一次性清零 → 本 PR 升为硬闸。新增视图层 `bg-violet-500` / `text-fuchsia-*`
  / `border-sky-400` / `ring-emerald-*` 等 raw palette 直接阻断，不进基线。

  清零路径两条：
  - **状态色**走 §3.6.2 统一状态映射（`bg-success` / `bg-primary` /
    `bg-destructive` / `bg-info` / `bg-warning`）；
  - **brand 双色渐变与域装饰色**走 `// p71-allow:start …` 或
    `{/* p71-allow:start … */}` 就地声明（P71/P79 共享一份 allow · 见
    `#1072` 解锁 · 与 `stripP71AllowBlocks`）。

  与 P70（space-y/x→gap）/ P72（模态可访问名）/ P80（w-N h-N→size-N）
  同族：判据引入 → 分片治理清零 → 独立 PR 升硬闸。

## 自查

- [x] pre-commit 29 道全绿（`--update` 后 baseline total 4 → 4 无变化 · P79
  条目已从 files 剥离、余下 P76/P77/P78 各 1-2 处保留棘轮）
- [x] `changelog.d/0-p79-hardgate.md` 碎片
