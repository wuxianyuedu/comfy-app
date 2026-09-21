## Changed

- **移除 tRPC `timingMiddleware` 的 dev 期人为延迟（性能）**：`src/server/api/trpc.ts`
  的 `timingMiddleware` 此前在 `isDev` 分支里对**每个** procedure 强制
  `await sleep(Math.random()*400+100)`，即人为加 100–500ms。这是 create-t3-app
  脚手架「模拟网络延迟」的遗留，对本地 Tauri 壳 ↔ loopback server 的单机应用毫无
  意义，却是 dev 期「整体偏慢」的最大单一来源——一个面板挂载常有 3–5 个并发
  tRPC 调用，叠加即 0.5–2s。现删除该注入（及其唯一消费方的 `sleep` import），
  保留耗时测量与「慢查询 warn / 失败 error 落日志」的观测语义不变。
  `src/server/api/trpc.test.ts` 顶部说明同步更正：限流超窗测试预填共享桶是为了
  以最少真实调用确定性命中 `TOO_MANY_REQUESTS`，不再以「人为延迟」为由。
