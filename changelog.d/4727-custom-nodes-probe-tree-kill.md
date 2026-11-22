## Fixed

- **custom-nodes 探测子进程超时回收改走进程树统一出口（#4727，#3897 的子项）**。
  `spawnCapture` 的看门狗超时此前只 `child.kill()` 单杀直接子进程，若该 Python
  解析器内部再起子进程会残留孤儿 —— 与硬规则 3「进程清理必须杀整棵树」不符
  （同文件流式路径的 `createStreamChildGuard` 已按此口径走 `killProcessTree`）。
  现在两条路径同源：超时回收统一 `killProcessTree({ pid, force: true })`；
  回归用例真起长跑子进程、真回收，并探活确认目标确实退出。
