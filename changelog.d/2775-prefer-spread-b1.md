## Changed

oxlint `unicorn/prefer-spread` 迁移第一批（#2775）：库层 6 份中枢模块的 6 处 `Array.from(x)` / `arr.slice()` 改为展开语法（`[...x]`）——`src/lib/llm/types.ts`、`src/lib/page-window.ts`、`src/lib/ordered-set.ts`、`src/lib/server-cache.ts`、`src/server/api/routers/model.ts`、`src/server/api/routers/series-generation.ts`。

单独成批是因为这 6 份的受影响用例闭包有 272 份（42 份的其余改动面闭包 184 份），一次带全会让「受影响用例」格超出墙钟预算。整条规则在第二批收官。语义核对：`[...new Set(values)]`、`[...map.keys()]` 与 `items.slice()` → `[...items]` 都是浅拷贝 / 去重后的同序序列，`cacheDelPrefix` 改为直接遍历 `keys()` 等价（边遍历边删除当前键不影响后续键）。`tsc --noEmit` 与 eslint 通过。
