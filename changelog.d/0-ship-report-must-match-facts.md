## Fixed

- **屏幕上那句「✓ 已建 PR」可以没有任何 PR 撑着** —— 同一条链上更重的一格：
  `cnb pulls post-pull` 的响应**能解析**、`data` 里却没有号（这次是 `--title` 带着
  `--only=commit/push/pull-request` 经 PowerShell 宿主转发时失败），上一版把
  `✓ 已建 PR #null` 打在**取值之前**，随后才由调用方退 2 —— 于是屏幕上写着成功、
  平台上根本没有那个 PR（实测：`cnb pulls list-pulls --state open` 里查不到这条分支）。
  现在「念出口」排在「验到有号」之后，并把**响应原文与 stderr 一起转述**（`cnbJson`
  开始带回 `stderr`）—— 只说一句「没有结论」等于把线索吞掉，而这一族的职责恰恰是
  如实转述执行者。用例：喂一份 `{status:400,data:{message:"title invalid"}}` ⇒
  不许出现「已建 PR」、原文与 stderr 都可见、退 `NOT_RUN`。

- **`pnpm ship --only=commit` 一段都没跑，却打印「全绿到终态」并退 0** —— 三态退出码里
  那条「没跑起来 ⇒ 2」本来就是给这种形状准备的，只是**空账**这一格没人接：
  阶段 0 之外的每一段都嵌在 `want("preflight")` 里面，所以 `--only=commit` /
  `--only=push` / `--only=pull-request` 三种单跑都是「一条结论都没落」，而
  `combineShipCodes([])` 回 `0`。实测同一条入口（本 PR 修之前）：
  `node scripts/ship.mjs --only=commit --dry-run` 只输出那句结论、退 0。
  修法落在收口那一处：`finish()` 见到空账就退 `CODE.NOT_RUN` 并把原因说出口
  （带上本次请求的阶段名）。**按「有没有落下结论」判、不按「请求了哪个阶段」判** ——
  将来再加段、或有人把某段改成条件跳过，都掉不回同一个假绿灯。
- 探针先在未修代码上打红：新增那三条（`commit` / `push` / `pull-request`）复算时是
  `expected +0 to be 2`，同时钉住「这三段各自的写动作一条都不许伸出」；反向保留
  「`--only=preflight --dry-run` 照样退 0」那一格，免得守卫把唯一能单跑的那段误伤。
  修完 44/44，并拿真命令复算：同一条 `--only=commit` 现在退 2 并打印原因。
- 文件头「用法」里那句 `--only=poll # 单跑一段（排查用）` 一并改成实际语义
  （只有阶段 0 能单跑，其余单跑退 2 并说明为什么）—— 上一轮 `--only=poll` 那批
  被显式拒绝时，这行使用说明就已经是旧的了，没人会去读一段不存在的用法。
