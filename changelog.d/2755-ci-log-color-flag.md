## Fixed

- **平台日志页那一屏现在也带三态色**（ISSUE #2755，#2748 的下一跳）：#2748 把颜色层接到
  了聚合档自己那一屏，但业主看的那一屏是**平台的日志页**，而它一个字都没变。当场读数：
  绿跑 build `cnb-gig-1k65nb59l` 的 stage-27 正文 64 行里只有 2 行带 ANSI，那两行还是平台
  自己的 `Runner` / `Finished` 前缀——平台 stage 的 stdout 不是 TTY，`colorEnabled()` 按
  「非 TTY ⇒ 不上色」判成不上色；而同一份正文里那枚绿色 `Runner` 证明查看器**会**渲染色号。
  那一格落在边界两个判据之外：既不是 TTY，也没有人按字节解析它，它是「一块会渲染色号的
  屏幕」。⇒ 给它一枚只被**本层**认的旗标 `.cnb.yml` 流水线级 env 的 `COMFYAPP_CI_COLOR`
  （`colorEnabled()` 在 `NO_COLOR` 之后、TTY 之前认；`0` 与空串按关算）。**不用
  `FORCE_COLOR` 顶这一格**：那枚 chalk / picocolors / oxfmt 的 anstyle 都读，挂上会把
  聚合档**捕获后解析**的那份子进程输出一起点亮，`lastLine()` / `looksSkipped()` / 90 字
  压缩三处都会把色号算进内容。端到端那条用例起子进程时 stdout 是管道（与平台同拓扑），
  并刻意摘掉环境里的 `FORCE_COLOR`，免得开发机上恰好有它时为错误的理由通过。
