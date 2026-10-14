## Fixed

- **11 个文件的 prettier 格式漂移（`text-4xs` 立档后漏跑格式化）**：`pnpm check:format`
  （硬闸、无基线）在 `origin/master @ 3aae3031` 上就已经命中这 11 个文件 —— **不是本 PR
  引入的**，但它挡着所有人的提交，按规范 §13.6.2 就地收掉。
  复算证据（`node scripts/base-check.mjs node scripts/check-format.cjs`）：
  `baseline-red`（本检出 1，`origin/master @ 3aae3031` 1），两侧同一批文件。
  成因是「给 9px 立 `text-4xs`」那一批手工改的 class 串里，`text-4xs` 没排在
  prettier 认可的词序位置（Tailwind class 排序）；只是格式，无行为变化。

- **同一成因的第二处：`@theme` token 清单快照漏更新**：`tests/theme-tokens-compile-source.test.ts`
  的 `__snapshots__/theme-tokens.css-theme-surface.txt` 也停在 `text-4xs` 立档之前 ——
  `--text-4xs: 9px` 确实声明在 `@theme` 里（`globals.css:355`，22 处消费），只是那份
  快照没跟着更新，于是这条用例在 `origin/master @ 3aae3031` 上同样红
  （`base-check` 复算：`baseline-red`）。按用例的既定口径（快照是「人工 review 的对象」）
  用 `vitest -u` 更新，diff 恰为一行 `--text-4xs`。
