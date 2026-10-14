## Changed

- 控制台在宽屏上不再左右留白：它改用 `DocumentFrame` 新增的 `full` 档位（不封顶），
  内容吃满滚动区、只留 `px-4 sm:px-8` 的内边距。此前走 `wide` 档（1200px 居中列），
  窗口再宽也只是把两侧的空白拉大 —— 而这一屏的主体是输出面板，要的正是那点宽度。
- `DocumentFrame` 的宽度档位由三档扩到四档（`narrow` / `medium` / `wide` / `full`）。
  前三档的数值仍只在 `globals.css` 的 `--container-*` 一处；`full` 是「不封顶」，
  `max-w-none` 就是判据形态。storybook 的档位选项此前已按四档写着、实现只有三档，
  这一笔把两边对齐。
