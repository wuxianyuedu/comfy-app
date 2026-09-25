## Added

- **UI 基元棘轮新增 P79「视图层无 dark: 前缀的浅色原色板」（棘轮，`scripts/check-ui-primitives.cjs`）**：
  与 P71 是同一族账的两半。P71 只管 `dark:` 前缀的调色板（把同一件事在明暗
  两处各写一遍）、P79 补上**无前缀的浅色版原色板** —— shadcn `styling.md`
  原则 4：`Use semantic colors. bg-primary, text-muted-foreground — never
  raw values like bg-blue-500.`

  项目的 `--color-primary-strong` / `--color-info` / `--color-success-strong`
  / `--color-warning-strong` / `--color-destructive` / `--color-subtle`
  / `--color-border-strong` 等 token 内部已含浅/深两态（`globals.css`），视图
  里出现 `bg-violet-500/40` / `text-fuchsia-700` / `border-sky-400` /
  `ring-emerald-400` / `from-red-*` / `to-amber-*` 这类**具体 palette 色名 +
  数字档位**（无论是否带 `dark:`）就是绕开语义 token、把主题色硬编码。

  锚点复用 P71 的调色板色名表 + 前缀集，做两点收窄：① 去掉 `dark:` 前缀强制
  （这条就是数无前缀的浅色版）；② 用 `(?!dark:)` 前瞻把带 `dark:` 的排掉、
  避免与 P71 双计。例外块**复用 P71 的 `p71-allow:start … p71-allow:end`**
  ——同一族账：palette 字面量本身就是语义（ANSI SGR 8 色 / workshop 域专有
  装饰色 / 媒体类型色 / 文件夹黄橙 / 品牌渐变端点 …），不能被 token 化，走
  同一份 allow 块；一条 `p71-allow` 覆盖两条判据，比再造一个 `p79-allow` 更
  省也更难漏标。

  走棘轮：本批上线时视图层实测 **24 文件 67 处** 存量（`studio/**`、
  `workshop/**`、`ui/**` 里非 EXEMPT 的部分），`--update` 冻结起点、只许降。
  下一批按域分片迁语义 token（与 P71 治理同批节奏）。

  差分回归 4 例见 `tests/check-ui-primitives.test.ts`：视图层 `bg-violet-500`
  计入 / 带 `dark:` 前缀的归 P71（P79 不误伤）/ 语义 token（`bg-primary`、
  `text-ink-muted`、`border-border-strong`、`ring-primary/30`）不误伤 /
  `p71-allow` 块对 P79 同样生效（一份 allow 覆盖两条判据）。
