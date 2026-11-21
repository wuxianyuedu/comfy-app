## Fixed

- 全站低对比度清理（#4712）：`--color-ink-fainter` 加深到浅 `#767680`（4.50，过 AA）/ 暗 `#7d82a0`，`--color-ink-faintest` 加深到浅 `#8e8e99` / 暗 `#6b7088`（原 #b6b6bf 压白仅 2.0）；24 处承载可读信息的 `text-ink-faintest` 升级为 `text-ink-fainter`；3 处固定深底（`bg-black/70` 叠层）上误用的 `text-ink-soft` 改固定浅字 `text-white/90`（浅色主题下原为「深底深字」）。
