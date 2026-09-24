## Fixed

- **尺寸选择浮层（比例 / 清晰度 / 百万像素 / 倍数）点选后没有选中高亮**：选中态
  此前写成 Radix 时代的 `data-[state=on]:`，而 base-ui 的 `Toggle` 输出的属性是
  **`data-pressed`**（`@base-ui/react/toggle` 的 `ToggleDataAttributes` 里写着
  `const pressed = 'data-pressed'`）。两者错位时**没有任何报错** —— 面板照常开合、
  点击照常有回调，只有高亮整体消失。`ui/toggle` 里同款永不匹配的选择器一并改正
  （那里靠 `aria-pressed:` 侥幸还有底色）。

  回归护栏：`src/components/ui/segment-popover.test.tsx` —— ① 选项确实带
  `data-pressed`（基元侧）；② 选项类名用的是 `data-[pressed]:` 且不含
  `data-[state=`（我们这侧）。任一侧被改回去都会变红。
