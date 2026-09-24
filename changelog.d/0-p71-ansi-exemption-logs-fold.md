## Added

- **P71 支持 `// p71-allow:start …` / `// p71-allow:end` 例外块**
  （`scripts/check-ui-primitives.cjs`）：标记之间的代码整段不计入 P71。用途是
  规范 §3.6.1 文档化例外——**palette 字面量本身就是语义**（如 ANSI SGR 终端 8
  色，代表 terminal color identity、不是主题状态色），没有对应语义 token、也不
  应被 token 化。比把这些行长期挂在棘轮基线上当「降不掉的债」更诚实：判据仍在、
  理由写在标记行上、且豁免范围被显式圈定在一小块。新增私有 helper
  `stripP71AllowBlocks()`，必须在 `stripComments` **之前**跑（否则标记注释先被抹掉、
  块内 `dark:` 又会被计回来）。回归测试见
  `tests/check-ui-primitives.test.ts` 的三条 P71 用例（含「同文件块外计、块内不计」
  的差分断言）。

## Changed

- **logs 域剩余 P71 命中折叠 / 归位**（接上一批 log-level 语义化，把整个
  `src/components/studio/logs/` 收干净）：
  - `logs/log-row-style.ts` 的 `TOKEN_CLASS`（ANSI SGR 终端色表，12 处
    `dark:palette`）改用上面的 P71 例外块标注——这批**不是**该 token 化的状态色，
    而是终端颜色身份，走 §3.6.1 例外而非基线债；
  - `logs/LogPanel.tsx` 头部图标 `text-violet-700 dark:text-violet-400` →
    `text-primary-strong`（品牌紫 → primary token，两态**精确等值**）；
  - `logs/LogPanelOriginSelect.tsx` 计数列的 warn/error tone：
    `text-amber-600/rose-600 + 手写 dark:` → `text-warning-strong` /
    `text-destructive`（与 log 徽标同源；深色档略增一档饱和度，计数文字属**有意**
    正常化）。

## Notes

- 本批把 P71 基线从 **215 → 200**（12 处 ANSI 转例外块、不计入；3 处状态/品牌色
  token 化）。
- 修正上一批碎片的一处失准表述：那条说「`TOKEN_CLASS` 无 `dark:` 前缀、天然不命中
  P71」——**不成立**，它有 12 处 `dark:` 手写档、确实被 P71 计到（当时被冻结进基线）。
  本批以「§3.6.1 例外块」把它正确归位。
- 剩余 200 处仍按域分片降：`workflow-library`（37）、`workshop`（31）、
  `project-canvas`（30）、`app/(main)`（18）、`history`（17）等。其中
  `history` 域多为 status pill（cyan/violet/emerald/red/amber 的类型色 + 状态色），
  token 值非全部精确等值、需逐案视觉核对，是下一批的主要候选。
  logs 域只剩 `logs/LogRow.tsx` 的搜索命中 `<mark>` 高亮（1 处 amber）——它是装饰性
  高亮、非状态色，合适的修法是先补一个「命中高亮」语义 token 再折叠，不该硬塞
  warning-* 或滥用 allow 块。
