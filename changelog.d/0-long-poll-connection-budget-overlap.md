## Fixed

- **修掉一处「客户端轮询把浏览器同源连接预算占满、连累按需加载的请求」的根因**——现场是
  在 ComfyUI 页点「去设置里配置」后状态栏**必定**翻成「应用服务已断开」。
- 根因在轮询原语 `src/lib/poll-timer.ts` 的 `ms` 返回 `0` 那一档：它本意是「本拍跑完
  立刻再跑一拍」（事件驱动的长轮询专用档），但实现是在 `tick()` 之后**立即**排下一拍、
  **不等 `run` 结算**——于是 `ms: () => 0` 退化成 ~4ms 的空转。用量表实测：300ms 内叠发
  23 拍、**同时 6 拍在途**。浏览器对同源 HTTP/1.1 只有 6 条连接，这一条链就把整份预算
  占住，叠加 `/api/dev/server-id` 探活、SSE、tRPC 批量与按需编译分块后，网络栈当场报
  `net::ERR_INSUFFICIENT_RESOURCES`，其中就有点「去设置里配置」时**按需**发出的设置分块
  `import()`：它失败后走 `lazy-chunk-recovery` 的整页自愈刷新，在飞的 tRPC 被中断
  （`Failed to fetch`），刷新后连续两拍探活失败即翻成「应用服务已断开」。
  修法：`0` 档改为**等本拍 `run` 结算再立刻续排**（续排隔一层 `setTimeout(0)`，避免
  同步 `run` 退化成微任务空转；另加 `stopped` 判据兜住 `stop()` 之后的多跑一拍）。
  调用点（`src/lib/comfy/comfy-state-client.ts`）保持 `ms: () => 0` 不变——语义现在与
  它的注释终于一致。
- 同一根因的另一半在日志面板：`src/components/studio/logs/LogProvider.tsx` 每 2s 用
  `Promise.all` **并行**发 6 条 `/api/logs/current`（正好等于同源连接上限），且不设背压
  （一轮超过间隔时会直接叠出第二轮）。改为**六路串行 + `roundBusyRef` 背压闸**：任何
  时刻至多 1 条在途日志请求，一轮仍远快于间隔，面板的实时感无可感差别。
- 补一条判据钉住原语的 `0` 档（`src/components/ui/use-interval.test.ts`）：异步 `run`
  没跑完就不再发下一拍，跑完才立刻续排。
