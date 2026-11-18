## Fixed

- update-check 的 `runChecking` 用单个布尔守并发：30s 轮询与 Ctrl+Shift+U 手动触发并发时，先结束的一方把 checking 置 false，指示器提前熄灭（#4241）。改 single-flight（在跑时复用同一 promise）。用例：并发两路断言指示器在全部结束后才熄灭。
