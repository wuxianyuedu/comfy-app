## Fixed

- **media 过滤分页的 cursor 语义两侧统一，消除重复扫描读放大**（ISSUE #4741）：
  服务端 cursor 是对全量任务的 SQL skip，客户端却按「过滤后命中数」推进——带 media
  过滤翻页时，后续页从已扫过的位置重扫，重复返回已见行（每页最多重扫 400 行）；
  UI 靠 id 去重掩盖了重复，功能可用但读放大浪费，且与 `task.ts` 注释声称的 cursor
  语义不符。
  - 服务端响应新增 `nextScanCursor`（本次扫描前沿 = 起点 + 实际扫过的行数），
    无过滤路径与 media 过滤路径都回传。
  - 客户端 `getNextPageParam` 改为原样透传 `nextScanCursor`，不再自行累计命中数；
    翻页不重不漏。
