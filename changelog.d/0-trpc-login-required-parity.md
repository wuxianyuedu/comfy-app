## Fixed

- **tRPC 面不再绕过 `loginRequired` 登录开关（安全）**：`authedProcedure` 此前无条件回落演示用户，而 REST 面的 `requireServerUser` 会检查 `app-settings.json` 的 `loginRequired`——开关打开后全部约 200 个业务 procedure（workflow/task/run/setting/train 等）仍可匿名调用，安全开关只在 REST 面生效。现在两个 API 面共用 `~/lib/auth-server` 的 `requireServerUser` 单点判决：`loginRequired=false`（默认，本机单用户）行为不变；`loginRequired=true` 且无会话时 tRPC 返回 UNAUTHORIZED，且不再顺手创建演示用户行。顺带消灭了 `trpc.ts` 里复刻「缓存越过数据库」缺陷（库行被重建后仍返回不存在的 id）的第二份演示用户缓存实现，`DEMO_USER_EMAIL` 的读取也从两处收敛为一处。
