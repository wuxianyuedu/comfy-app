## Fixed

- **「应用服务已断开」在服务好好地跑着时误报，且断开原因读不到具体读数**（ISSUE #4140）。
  用户现场：正常操作应用（ComfyUI 同进程启动的约 70s 重载窗口内），界面翻「应用服务已断开」，
  而服务与页面全程正常（事后核：进程未退、bootId 未变、无结束记录）。两处判据缺陷叠加：
  - **探活单拍超时 2.5s 太紧**：`/api/dev/server-id` 探测在重载窗口（ComfyUI 同进程启动 /
    冷编译 / 按需编译 / Turbopack 抢锁）里连续两拍超时（≈4.5s 无应答）即翻「已断开」。
    改法：单拍超时收口为 `PROBE_TIMEOUT_MS = 5s`。进程**真死**时 TCP 立即拒连（ECONNREFUSED）、
    不走超时，真实断开的检出速度不变（仍由 `OFFLINE_CONFIRM_FAILURES = 2` 连拍决定，约 2~4s）；
    只有「进程活着但一时答不上」才走满超时——那一档要**连续约 7s** 无应答才判断开，
    重载窗口里 ≤6s 的慢应答不再误报。
  - **事件循环阻塞观测在 dev 热重载后静默失效**：运行期改写 src 内源码文件（如侧栏偏好落盘
    改 `sidebar-tab-defaults.json`）会触发 Turbopack 重新实例化 `event-loop-watch.server.ts`，
    而 `instrumentation.register()` 每进程只跑一次——模块级 `timer`/`blocks` 随旧实例变孤儿，
    `GET /api/dev/loop-blocks` 从此永远回 `running:false, blocks:[]`，「应用服务已恢复」那条
    消息读不到阻塞事实，只能写「多半是短暂无响应」（观测实测读数：本检出当前就处于该状态）。
    改法：观测状态改挂 `globalThis` 单例——新旧模块实例共享同一份 `timer`/`blocks`，
    旧实例的心跳继续记、新实例的端点读得到，恢复消息能把「多半是抖动」换成实测的
    「事件循环被阻塞了约 Ns」。
  - 回归：`tests/event-loop-watch.test.ts` 新增「状态跨模块实例存活（dev 热重载）」一组
    （重实例化后运行标记与已记阻塞不丢、重复启动不叠加定时器）；
    `use-dev-server-liveness.test.ts` 钉住 `PROBE_TIMEOUT_MS = 5000`；
    既有「单拍抖动不算断开」「探活端点 404」「runId 留存」等 65 条全绿。
