## Fixed

- `src/lib/log/capture-streams.server.test.ts` 的两条「写进 stdout / stderr 的内容要出现在转录文件里」不再同步读盘 —— 转录实现早已改成**攒缓冲落盘**（`bufferedAppend`：满 64KB 或最多 1s 一次，避免高频日志下每行一次 `appendFileSync` 把事件循环占满），而同步 `readFileSync` 只能读到安装时写的会话横幅，于是两条断言拿到的是空转录。
  改法：加 `readCaptureWhenFilled(file, needle)`，按截止时间轮询到目标文本出现（正常路径几乎立刻命中，比固定 sleep 快）；**超时就原样返回**，所以「压根没落盘」仍会被断言读成红，不会被误当成「再等等就有」。
  顺带记下这份用途的既有权衡（实现里已写明、这里不改行为）：进程退出时最多丢一份未满的缓冲 —— 面板转录可接受，但**崩溃现场那最后一秒**可能正好是那条 FATAL；要收这个口，得给模块挂 `process.on("exit")` 冲刷，那是另一条决定。
