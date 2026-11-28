## Fixed

- 代码驱动影片关键帧展开器（#5225）：全局帧夹取原用 `Math.min(Math.max(...))` 手写，命中 UI 基元复用棘轮
  P59（规范 16 §16.2.3，要求走 `~/lib/clamp`）；改用 `clampInt`，pre-push 合并前复算恢复全绿。
