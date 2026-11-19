## Fixed

- **ComfyUI 启动等待日志逐拍刷屏聚合为单行进度（ISSUE #4149）**：状态轮询每拍
  （~2s）都会重进 `resolveComfyBase()` 的「进程在、端口未绑定」分支并写一条
  同文 INFO——实测 70s 等待窗口 230 条，把面板里其它 INFO 全部顶出可视窗口。
  现按场次聚合：首条照发（文本不变，既有 grep / 面板口径不动），其后每 30s
  一条「已等待 Ns，仍未绑定端口」进度行；端口绑定（三处 Connected 落点）即视为
  场次结束、状态清零，下一次启动重新从首条开始。判据收在与
  `shouldLogProbeMiss` 同族的纯函数 `startingLogAction`（now 可注入），
  回归用例钉住「70s / 2s 拍 → 1 首行 + 2 进度行」与「终态复位后重新首条」。
  轮询与就绪判定本身一字未动；「Cannot reach ComfyUI…」WARN 的 60s 节流
  不在本单范围、原样保留。
