## Fixed

- **「类型检查」格补 `读取的树` 读数与 `exclude` 摘要**（ISSUE #3041 跟笔；上一笔 #3087 已补「判决面 + 版本」）：`[ci-run-tool] 判决面` 现在同时念 `include` 与 `exclude`，并新增 `[ci-run-tool] 读取的树：HEAD … · CNB_COMMIT …` —— 两个 sha 不相等时明写「平台合成合并预览，报错行号属于合并后的树，别拿 PR 顶端逐行对照」。#2990 的六条行号对不上就是这一形态：行号陈述的是合并后树里 `ci-heavy-gates.mjs` 的版本，不是 PR 顶端那份。
