## Added

- **`pnpm ship` 现在会交代、并（点名才）收拾本检出的工作进程（ISSUE #2150）**：阶段 0 多一行
  `本检出应用实例：无 / N 个（via session|port · pids …）`，取自硬规则 9 那条唯一归属判据
  （`launcher-core/port-reap.mjs` 的 `runningAppInstances()`）—— **是读数、不参与退码**：
  有人在用 dev server 是正常状态，把「有进程在跑」判成红就是误报，还会逼人绕开这条链。
  真收要 `--reap`，而且**只收 `via:"port"` 那批**（有人绕过编排器自己 `pnpm dev` 起的那种，
  才是任务结束后还在跑的残留）；`via:"session"` 意味着**编排器还活着** —— 那不是残留，
  停它要走编排器自己的收尾（`tools/start/*` 或 `dev-launcher.mjs` 的退出回收），这一格落 `2`
  并明说「不是没东西可收」，**不许**念成「没有需要收的」（那正是实现这一格最容易犯的谎）。
  收完必须**独立回读**同一条判据：`reap-process.mjs` 全部退 0 不算结论（回读还在 ⇒ 红，
  回读拿不到 ⇒ 2）。不泛匹配 `node.exe`、不按端口反查（硬规则 3：各写一遍正是历史上误杀
  兄弟检出与单杀留孤儿的根因）；不给旗标一次都不伸手；`--dry-run` 只印进计划。
  单独收一次：`pnpm ship --reap --only=preflight`；只想看在不在跑：`pnpm deps:guard`。
  新文件 `scripts/ship-reap.mjs` 内容全是**接线** —— 归属与回收两件既有实现都不重写，
  「哪一档归谁收」判断在纯函数 `decideReap()` 里（写在效应代码里就会被写漏）。
  回归见 `tests/ship.test.ts`：判据答「无」不发回收、`via:port` 逐个发并回读、
  **`via:session` ⇒ 不杀也不许念成无事可做**、`running:true` 却没 pid ⇒ 2 且不反查、
  判据抛错 ⇒ 2、回读抛错 ⇒ 2、回读说还在 ⇒ 红、`--dry-run` 零调用。
