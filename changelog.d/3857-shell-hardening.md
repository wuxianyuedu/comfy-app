## Fixed

- **Rust 壳幂等加固**（ISSUE #3857）：
  - `navigate_to_app` 加壳侧一次性防重入：启动页探测 tick 失败 3 秒重试期间反复
    invoke，原先每次都重新导航（已加载页面整页重载）并新起两个看护线程；现在
    `AppState.navigated` 原子标记先抢，导航失败把标记还回保留前端重试闸。
  - `run/launch-status.json` 与应用服务结束记录改 tmp+rename 原子写：多写方一读方
    （启动页 250ms 轮询）不再撞到空串 / 半截 JSON。
  - 退出回收换序：先派发统一回收（reaper）再插件 kill——taskkill 的目标在进程
    还活着时不存在 PID 复用，原先「kill 成功 → 丢句柄 → taskkill」之间的
    PID 复用误杀窗口被整个消掉；会话锚点清理放宽为「两道任一落地」。
  - `spawn_sidecar` 加槽位守卫：已有句柄时拒绝重复拉起，不再把旧 child 覆盖成孤儿。
