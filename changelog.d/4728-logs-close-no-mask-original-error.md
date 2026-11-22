## Fixed

- **logs 三个路由 `finally` 内 `handle.close()` 的清理错误不再覆盖原始异常
  （#4728，#3897 的子项）**。`current` / `history` / `sessions` 三处
  `try { await handle.read(…) } finally { await handle.close() }` 形态下，
  read 抛错且 close 也抛错时，close 的异常会取代原始堆栈向外抛，路由 500
  的根因失真。现在 close 的清理侧错误就地吞掉（与 generated 路由的 close
  口径一致），回归用例钉住「500 的原因含 read 原文、不含 close 错误」。
