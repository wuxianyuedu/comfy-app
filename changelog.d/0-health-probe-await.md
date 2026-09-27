## Fixed

- **`GET /api/health` 不再对坏库回「健康」**（`src/server/db.ts`、`src/app/api/health/route.ts`）：
  `pingDatabase()` 里那条 `db.run(sql\`select 1\`)`在换成异步驱动（libsql）之后就返回
Promise 了，而它既不等、函数签名还写着`void`—— 于是探活**永远不会失败**：路由回`200 + db: up`，reject 变成一个游离的 unhandled rejection。对 UptimeRobot / Grafana /
容器健康检查来说，这个端点因此变成「永远健康」，而它的注释还写着「行为与原路由的
`SELECT 1`探活一致」（原路由是同步驱动，真探得到）。
现在`pingDatabase`把 Promise 交出去、路由`await`它，真失败走既有的`503 + db: "down"`分支；用例补第四条契约（探活被 mock 成 rejection → 503 + down），
**反向验证过**：把路由的`await`去掉，这条即红。此前 mock 直接把`pingDatabase`替成`vi.fn()`，「有没有 await」这件事在测试里根本不可见。
规范 launch-and-build §9.1 的健康检查一行同步记了这个出口。
（`src/server/db.ts` 在「构建期模块保持纯 ASCII」的白名单里，新增注释按该规则写英文。）
