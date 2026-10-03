## Added

- **设计系统契约 `docs/DESIGN.md`**：把散在 `src/app/globals.css` 的 Tailwind v4 主题、
  `src/components/ui` 的 83 个基元与 `docs/standards/03·04·06·16` 里的样式决定，收成一份
  「机器可读 frontmatter + 人读正文」的单一契约，作为 Design QA / design-debt / a11y /
  component-alignment 这几道评审的基准。正文按 confirmed / likely / conflict 分档，
  未决项标 `needs-design-decision` 而不替设计 owner 定口径。
  取证一律实测（`sed -n` / `grep -c` / 真编译 `globals.css` / Playwright canvas 解 oklch），
  测量命令与逐条来源列在文末「取证方法」。
  **本次实测出的三条事实**（均不在既有门禁覆盖面内，故只登记不擅改）：
  ① `@theme` 的 `--radius-sm/md/lg/xl: 8/12/16/20px` **从未生效**，产物里每个名字只有
  `@theme inline` 的 calc 那一份 ⇒ `.u-card` 实际圆角是 12px 而非注释所述的 16px；
  T2「`@theme inline` 不得重名」判据只匹配 `--color-` 前缀（`tests/theme-token-single-source.test.ts:174,180`），
  圆角命名空间是盲区。② 规范 06 §6.7 要求所有 `transition`/`animation` 有
  `prefers-reduced-motion` 降级，实测 `src`+`public`+`.storybook` 命中 **0 次**、
  而 `src/components` 有 **113 处** `transition-*`。③ `--font-title` 首选 `Sarasa Gothic SC`
  既无 `@font-face` 也不在 `next/font` 里，在未装该字体的机器上会静默回退——而桌面包正发往那种机器。
