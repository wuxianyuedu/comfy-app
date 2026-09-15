## Fixed

- **追加不轮转日志的每次启动之间补一条会话分隔横幅，本次从哪开始一眼可见（ISSUE #592）**：`log/services/app-runtime.log` 是追加不轮转的，多次启动的行全堆在一个文件里，条与条之间没有断点——直接打开文件的用户分不清本次运行是从哪一行开始的。现在每次应用服务启动时由 `installStreamCapture` 往该文件写一条**会话分隔横幅**：两侧各留一个空行（用户要的「每次启动之间需要行空白」），由 box 字符分隔线与 ANSI 亮色勾勒，横幅本体**不带时刻**（时刻只留在每条行首，避免与紧随其后的行首时刻差 1 秒被读成一条）。横幅实现同时收敛为 `src/lib/session-banner.server.ts` 的**唯一**实现（`buildSessionBanner` 纯函数 + `appendSessionBanner` 唯一 IO 出口），comfyui / drizzle-studio / ollama 三个 runtime 通道此前各抄的一份十几行实现一并改走它——同一段小函数被抄三份正是规范 §12.12.1 说的门禁死角，改口径漏一处就是**不同通道的边界长得不一样**。
