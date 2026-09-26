## Added

- 新增 P81 判据（棘轮）：**视图层 `<Button>` 直接子 icon 缺 `data-icon="inline-start|inline-end"`** · shadcn `composition.md`（Base UI + Tailwind v4 `has-*` 选择器）。项目 `ui/button.tsx` 的 `buttonVariants` size 变体里显式挂 `has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2`——只有 `data-icon` 存在时才切内边距。视图里 `<Button>` 直接放 icon 但忘了标 `data-icon=` 的表现：按钮左右内边距停在 `px-2.5`（无 icon 档）、文字与 icon 挤在一起；改主题或换尺寸档时得逐处补。
- 判据按形态取：`<Button[\s>][\s\S]*?</Button>` 块内、**深度 1**（Button 直接子级）处出现 icon-like 起始标签、开括号里不含 `data-icon=` 即计一处。icon-like 判据在 `isP81IconName`：项目自研 `<Icon name="…">` / 原生 `<svg>` / PascalCase 后缀 `Icon`（lucide 别名约定）/ 白名单内 76 个常见 lucide 组件名。深层嵌套（icon 被 `<span>` 等包着）不加 `data-icon` 也不生效，不属这条账、判据显式不计它。
- 视图层实测 114 处 / 51 文件（跨 `components/studio/**` · `components/workshop/**` · `components/message-center/**` · `components/ui/**` · `app/(main)/settings/**` 等）→ `--update` 冻结基线 114、只许降。
- 新增 4 处差分回归（`P81 Button 直接子 <Icon name> 无 data-icon` / `P81 合规出口 inline-start / inline-end` / `P81 深层嵌套不算这条账` / `P81 lucide 后缀 Icon 与项目自研 Icon/svg 一并算 icon-like`），总用例 303 → 307。

下一批按域分片（studio / workshop / message-center / ui 内部）把每个 icon 补上 `data-icon="inline-start"`（icon 在文字前）或 `"inline-end"`（icon 在文字后），走完后一个独立 PR 把 P81 加进 `HARD_GATE_RULES`（对齐 MEMORY 记录的「加棘轮完整节奏」）。
