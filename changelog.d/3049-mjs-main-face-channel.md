## Fixed

- 类型面分工补登记（ISSUE #3049）：主 `tsconfig.json` 经 `allowJs`+`checkJs` 的 import 图把**被引到的 `.mjs`** 纳入主面（硬闸零容忍）是登记过的决定，`.mjs` 全量面归 `tsconfig.scripts.json` 的棘轮——两档同一把尺、互补不重叠（§13.5.14.1）。`ci-run-tool` 在主跑红之后新增 `[ci-run-tool] 程序图里的 .mjs` 读数（`--listFilesOnly` 现算，绿跑不付这笔），别再照「主面不含 `.mjs`」的旧印象归因（#3041 的误诊现场）。
