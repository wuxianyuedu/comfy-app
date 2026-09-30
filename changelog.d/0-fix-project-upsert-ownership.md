## Fixed

- **`project.upsert` 不再能覆盖别人的画布**（安全台账 A3 同族，本批写归属判据时照出来的）。
  项目 id 由客户端生成（画布 localStorage 里的 `proj_*`，每次自动保存原样送上来），
  而 `projectRepository.upsertForUser` 的 update 分支**只按 id 定位行** —— 任何人把一个属于
  别人的项目 id 写进请求，就能把对方的 `name / nodes / edges` 整幅覆盖掉，而响应回的是
  200、前端看不出任何异常。现在 `upsert` 与 `get` / `patch` 同口径先判归属：
  行不存在 → 建在我名下；行存在且归我 → 覆盖（自动保存的正常路径）；
  行存在但不归我 → `FORBIDDEN` 且**一行都不改**。
  这一路的前端是「尽力而为的镜像」（localStorage 才是画布的事实源），失败会被吞掉，
  所以服务端必须留一行 warn —— 否则「我的画布为什么不进服务端列表」没有可查的出口。
  判据：`src/server/api/routers/project.test.ts`（含「他人 id → FORBIDDEN 且对方那一行一字
  不动」，反向验证过：把归属判定短路，恰好这一条变红）。
