## Fixed

- 日志落库防抖/看门狗定时器回调的 `void persistLogs` 无兜底，双重失败（落库失败 + logger 也起不来）走 unhandledRejection 可崩 executor host（#4221）：三处回调改走 `fireAndForget` + stderr 最后通道（logger 不可用时两宿主都被启动链捕获落日志），语义从「意外崩进程」改为「响亮留痕 + 继续跑」。用例：注入双重失败，断言 stderr 落痕且无 unhandledRejection。
