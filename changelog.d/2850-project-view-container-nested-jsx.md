## Fixed

`tests/project-view-container.test.ts` 抽取 `<DocumentFrame>` 的 `className` 时改为按花括号深度找开标签的 `>`，并只取**顶层** `className`：`backdrop={…}` 里的嵌套元素（含自己的 `/>` 与 `className`）不再被误当成外层属性。

这条不是本 PR 引入的：`node scripts/base-check.mjs pnpm exec vitest run tests/project-view-container.test.ts` 在 origin/master @ ed62db39 上同样命中（`baseline-red`）。`ProjectHomePage.tsx` 的 `backdrop={<AuroraBackground />}` 排在 `className` 前面，旧正则把嵌套元素的 `>` 当成开标签结束，于是永远抽不到 className，前置断言恒红；`HomePage.tsx` 同形状会把 backdrop 的 className 当成外层。顺手收掉是因为它挡住了「受影响用例」这一格。
