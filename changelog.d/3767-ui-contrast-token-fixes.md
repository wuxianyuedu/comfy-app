## Fixed

- 修复四组低对比度的 UI 语义色组合（#3767 / #3768 / #3769 / #3770，Playwright
  逐元素 WCAG 对比度实测后立项）：
  - `--color-success-strong` 亮色 `#10b981`→`#059669`（压白 2.54→3.77）；
  - `--color-accent` `#ff5ca8`→`#fb4599`（白字压它 2.86→3.27，两态同值）；
  - `--color-ink-fainter` 亮色 `#a1a1aa`→`#8e8e99`（压白 2.56→3.24）；
  - 新增 `--color-on-success` / `--color-on-accent-soft`（亮色白、暗色深墨）：
    亮彩实心底（暗色档 `#5be3c4`/`#ff8ac4`）上的文字不再用白字（1.59/1.06），
    `success-solid` 按钮与 token 墙色票同步改挂新 token；
  - token 墙 `bg-warning-soft text-warning-strong`（暗色 1.39）改为真实软底档
    `bg-warning/10 text-warning-strong`。
  `docs/DESIGN.md` 的 frontmatter 与语义角色表同批更新（契约判据以 CSS 为准）。
