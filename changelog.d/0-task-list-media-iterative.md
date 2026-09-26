## Fixed

- **`task.list` 的 media 过滤固定拉 400 行（`src/server/api/routers/task.ts`）**：
  `overFetch = min(take*4, 400)` 无条件把（含大 JSON 关联的）400 行拉回来、在内存里
  filter/slice —— 大多数请求第 1 页就够。`inferMediaType` 的判据依赖首图扩展名等
  应用层解析、纯 SQL 复刻不了，因此内存过滤保留，但改成**迭代补页**：一页凑满或数据
  耗尽即停，扫描行数上限与旧版对齐（400），普通请求只拉 1 页。
