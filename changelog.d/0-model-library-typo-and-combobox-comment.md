## Fixed

- **`ModelLibrary.tsx:463` className typo**：`text-ink-bright)` 末尾多了个右
  括号 —— 会被 tailwind-merge 与 class 分词器当成一个不认识的类，`text-ink-bright`
  完全不生效。删掉多余的括号即可。
- **`ui/multi-mode-select.tsx` 文件头注释订正**：注释里两处把
  `~/components/ui/combobox` 说成「基于 cmdk」——磁盘上的实际实现是从
  `@base-ui/react` 导入 `Combobox as ComboboxPrimitive`（Base UI 版）。
  原来的三条「不合并本件到 Combobox」的选型论证与 Base UI 版本同样成立、
  结论不变，只把「cmdk」这一处技术栈指称改成「Base UI Combobox」，并在末尾
  加一句"若未来 combobox 换栈需要重新评估本注释"，避免它像这次一样悄悄过期。
