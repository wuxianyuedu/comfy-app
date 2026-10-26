## Fixed

**点一下「关闭 Drizzle Studio」不再被记成 ComfyUI 的一次崩溃**（ISSUE #2435，规范 §5 排障手册那一行）。

- 当场读数（`log/current/services/drizzle-studio-runtime-20261026-172814.log`，是我自己按「关闭」那一次）：
  ```
  ■ Drizzle Studio 进程已退出：异常退出（exit 1）
  [exit] 异常退出（exit 1）（pid=73812 存活=59s code=1 signal=null 模式=studio）
  [exit] ↩ 看它崩溃前的最后几行输出……Python 侧异常、缺依赖、显存不足都会以非零码退出。
  ComfyUI 进程退出：异常退出（exit 1）
  ```
  三处各自错在一件事上：**主语写死**、**建议按 ComfyUI 的技术栈给**、**「我关的」这件事没被传进退出判决**。
- 根因不在 Studio 侧，在共用的那份退出原语里：`createChildExitHandler` 的 pino 那句是
  字面量 `ComfyUI 进程退出：…`（Studio 于 #570 复用同一套原语，于是跟着被改了名），
  非零码那条可行动作也只写了 Python 那一套；而 `stopRequested` 全仓唯一的置位点在
  `comfyui/lifecycle.ts`，Studio 的关闭路径直接杀树、从不落这个标记 ——
  旧代码里甚至留了一句注释解释「studio 侧没有用户主动关的标记」，那是把缺陷写成了说明。
- 改法：`ChildExitDeps` 用 `subject` 取代 `banner`（横幅与 pino 那行**由同一个主语拼**，
  原来两处各写一次名字正是漂移的通道）；`describeComfyExit` 的非零码建议按 `mode` 分
  （Studio 是纯 Node 包，念「显存不足」会把人支到它根本没有的方向）；
  `stopDrizzleStudio()` 在杀树前置 `stopRequested`、`ensureDrizzleStudioUp()` 拉起新会话时复位。
- **置位与复位是一批**：只置不复位，下一次真崩溃会被读成「用户主动关闭」——
  那是把唯一的故障线索抹掉，比原来那句假红更坏。复位放在拉起那一步（新会话起点），
  不放在关闭那一步（关闭可能杀不动、端口还在响应）。
- 判据：`src/lib/comfyui/lifecycle-exit.test.ts` 钉住建议按模式分且 ComfyUI 那侧一字未变；
  `lifecycle-wait.test.ts` 钉住原语里不留任何写死的主语；
  `src/lib/drizzle-studio/lifecycle.test.ts` 两条走**真链路**（假子进程挂上真退出回调 →
  真 `stopDrizzleStudio` → 读回落盘那几行）：主动关闭不再写成「异常退出」，
  而没人关的那次崩溃主语仍是 Drizzle Studio、建议里出现 `drizzle.config.ts` 而不是显存。
  该文件的运行日志写入器 mock 顺带改成收集行 —— 此前「写了谁的名字」这件事在单测里不可读。
