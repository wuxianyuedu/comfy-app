## Fixed

- **ComfyUI 再退出时，日志里能看出「它是由什么退出的」**（用户诉求：「有时候莫名就退出了」）。此前能看到的只有 `ComfyUI 进程退出（code=null）` 这么一句，而它缺三样：

  1. **`signal` 一直被丢** —— `exit` 事件的第二个参数没接，于是「被 SIGKILL 强杀」（外部动作：任务管理器 / Job Object 连带杀树 / OOM 杀手）与「自己 exit 1」（它自己的异常）在日志里长得一模一样，而两者排查方向完全相反；
  2. **保活模式（双击启动的主路径）压根没有退出事件** —— 进程是 `Start-Process` 的孙进程（Windows）或已 `unref`（POSIX），拿不到句柄，「它什么时候没的」根本不知道，只能等下一次状态轮询发现「不在了」；
  3. **不区分「用户点的关闭」与「自己挂了」** —— `stopRequested` 只喂给启动等待循环，不喂给退出回调。

  现在：判据收在 `src/lib/comfyui/lifecycle-exit.ts` 的 `describeComfyExit`（信号优先于退出码、用户主动关最先判、**拿不到就说拿不到**而不编一个 `code=0`），会话横幅直接写结论、`[exit]` 行带结构化明细（`pid` / 存活 / `code` / `signal` / 模式）与可行动作。

- **保活模式加退出监督**：`startComfyExitWatcher` 轮询进程表，进程消失即报「什么时候没的、活了多久」（拿不到退出码这件事如实说明）。
- **跨会话对账**：`log/services/comfyui-last-session.json` 记「会话开始 / 结束」，**有开始没结束**时下次启动提示「应用或系统在它之前就结束了」—— 这是 Windows Job Object 连带杀树、强制关机、任务管理器结束进程那一档唯一的出口（那些情况下没有任何活着的进程能写日志）。
- 同一个退出原语也被 Drizzle Studio 复用，一并受益（`lifecycle-wait.ts` 的 `createChildExitHandler` 现在要求显式给 `context`，调用方必须回答「pid / 存活时长 / 是否用户主动关 / 模式」）。
