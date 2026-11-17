## Fixed

- **退出回收给总预算**（#4219）：`RunEvent::Exit` 里编排器与 sidecar 两段回收串行、
  各自独立 10s 预算，叠加把关窗后的假死拉长到 20s 量级。现在两段共享同一个
  12s 截止时刻（后一段只拿剩余时间），到点强杀语义不变。
- **Mutex 中毒放大器拆除**：壳内 22 处 `.lock().unwrap()` 改为
  `.lock().unwrap_or_else(std::sync::PoisonError::into_inner)`——一处持锁 panic
  不再让后续所有锁连环 panic（不引入新依赖）。
