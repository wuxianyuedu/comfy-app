## Added

- `src/components/ui/toggle-group.test.tsx`（3 条）：钉住「选中档在基元里补足描边 + 字重 + 抬层」这件定制 —— 抽出 `data-[pressed]:*` 那组类断言描边/字重/抬层都在，并断言悬停档仍是官方版的 `hover:bg-muted`（正因为它与选中档同色，选中才必须多两层；这两条一起才说明「不是靠改悬停解决的」）；另钉住 `aria-pressed` 语义照旧由基元持有。

## Changed

- **`ui/toggle-group` 的 `ToggleGroupItem` 选中档补三层**（规范 16 §16.8 台账新增一行，文件头加 `ui-customized` 标记；`check-ui-customizations` 现报 9 个定制基元与台账一致）。
  起因是 P82 线上顺手查出的一条：官方版选中只有 `data-[pressed]:bg-muted`，而 `toggleVariants()` 里**悬停档是同一个 `bg-muted`** —— 鼠标划过未选中那一项，它立刻长得和「当前选中」一样，分段控件等于没有选中态。
  补的是**描边 + 字重 + `z-10`**，不是底色：基元不在 pressed 上设 box-shadow / 字重，所以不与悬停撞；`z-10` 保证 spacing=0 时描边不被相邻项盖住。底色仍留给调用方按需叠 —— 日志级别那一排要叠主色淡底，是因为它所在行头的 `bg-surface-1` 与 `--color-subtle` 在浅色主题下**同值**（#609 那一类，与这里的「同形」是两条成因不同的账）。
  受益面是全库 5 个选项组：`LogFilterBar`、`FilmStudio`（镜头来源二选一）、`UsageTestDialog`、`SizePresetTableModal`、`ui/segment-popover`。

## Fixed

- `LogPanel.test.tsx`「选中的类别在浅色/深色主题下都看得出」改用**类名 token 精确比对**，不再用子串包含。上一版 #1140 的断言 `expect(className).not.toContain("ring-primary/45")` 在 item 层补了 `data-[pressed]:ring-primary/45` 之后会把未选中项判成「也带着描边」—— 子串判据分不出「裸类」与「带变体前缀的类」。口径没动（未选中不得有那三层可见样式），只是换成语义上本来就应有的精确比对。
- `FilmStudio` 快照随本次 item 层类名变化重算。
- 台账里 `tooltip.tsx` 那行写着「`hint.tsx` 的 78 个调用点」—— 78 是 P82 旧粗锚的数字，真实治理量是 157（见 #1135 / #1136），改成不带过期数字的说法。
