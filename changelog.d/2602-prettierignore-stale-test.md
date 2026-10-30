## Fixed

- **「格式化工具不碰 src-tauri/target」的用例随执行者退役**（ISSUE #2602）：#2541 删
  prettier 时根级 `.prettierignore` 一并删了，而守它的用例还在跑——干净 master 上
  恒红 ENOENT。按单子的选项 2 处置：删除该用例，「现在谁在忽略 `src-tauri/target`」的
  答案（本门禁与 `format:check` / `format:write` 的扫描面收口在 `SCAN_ROOTS` 的两个
  目录 `src` 与 `.storybook`，`target/` 天然不在面内）写进 `check-format.cjs` 头注——
  结论留在有读者的地方，不只是删测试。同 describe 里 #2192 的 poll_clock 用例保留。
  **这份分支是从当前 master 上重建的**：`git diff 1ddf648b fad6a31d` 里有 553 份 `src/`
  文件被整份退回（两个分支互为祖先），直接合并会把主干的代码搬回旧形态；只有本 PR
  那 3 个文件的意图被逐条重放（`.prettierignore` 不重建、`.oxfmtrc.json` 的
  `ignorePatterns` 与那条行为档用例随后由 ISSUE #2603 重写，本批不动它）。
