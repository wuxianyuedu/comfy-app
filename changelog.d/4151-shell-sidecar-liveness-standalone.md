## Added

- **应用服务「断开」判据的双信号延伸到 standalone（分发）形态**（ISSUE #4151，
  #4146 的后续）：分发形态没有编排器与 `run/launcher-session.json`，此前壳的进程外
  信号在这一档答不上，桌包里服务忙把 HTTP 探活停走数秒时仍会误报「已断开」（#3369
  的原始现场）。
  - 壳侧 `get_app_service_liveness` 升为两档按序作答：第一档照旧读编排器会话名单
    （prebuilt）；第二档在会话文件答不上时，改查壳**直接持有**的内嵌 server
    `CommandChild` 句柄（`shell_launch::liveness_from_sidecar`）——句柄在 → 查 PID
    存活；壳在事件通道里亲眼看到 `Terminated` → 直接判死（句柄终生指向同一 PID，
    判死不受 PID 复用影响；句柄仍留在槽位里，退出时 `kill_sidecar` 照旧回收作业内
    残留）。
  - 三态语义与「不经过被测进程」的边界不变，前端零改动（判据本就按 `null` 退化）。
  - 回归：壳侧 `shell_launch` 新增 `liveness_from_sidecar` 三态归并用例
    （cargo test 66 条全绿）；release 壳已按硬规则重编。
