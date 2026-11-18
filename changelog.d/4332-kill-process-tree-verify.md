## Fixed

- **killProcessTree 的 Windows 分支不再「派发即成功」（#4332）**：此前 `wait:false`
  时 `spawnTaskkill` 派发完就返回 `ok:true`——taskkill 起不来（被安全软件拦 /
  PATH 异常）、权限不足、或目标在「扫描→派发」间隙已退出，调用方都拿到成功，
  孤儿继续占端口 / 日志文件。现在派发后**核结果**：等待 taskkill 退出（退出码
  进 via）+ 对 tree 模式做**有界事后探活**（默认 3s 预算，可经
  `verifyBudgetMs` 调整），目标仍存活 → 如实 `ok:false`；image 模式以退出码
  为准（128「无匹配映像」= 目标本就不在，视作成功）。`wait` 旗标保留兼容，
  两种取值现在都会核结果。
