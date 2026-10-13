## Added

- **AGENTS 硬规则 9 有了现场执行者，且两侧同一份判据**（规范 §3.2 / §9.5）：新增判据
  `runningAppInstances(root)`（`scripts/launcher-core/port-reap.mjs`），回答「**本检出**的
  应用服务此刻在不在跑」——两条信号都必须问得出归属：会话锚点（`run/launcher-session.json`
  心跳新鲜 + launcher PID 存活），或端口上进程的命令行命中本检出的 `dev.mjs` / `start.mjs`
  （复用既有 `isAppDevServerCmdline`）。两个消费点同批接上：
  ① **编排器补装之前**先问（`launcher-core/downstream.mjs` 的 `syncDependencies`）；
  ② 人不经过编排器直接装的那条路走 `scripts/deps-install-guard.mjs`
  （`pnpm deps:guard`，Windows 双击 `tools/start/sync-lint.ps1` 在 `pnpm install` 之前调它，
  判到即停而不是只警告）。
  成本：只在「lockfile 已漂移、真要去装」那一刻才探测，一次 netstat 实测 165ms，
  正常启动路径上根本走不到这一支。

## Fixed

- **启动链存在一条「实例活着照样 `pnpm install`」的路**（AGENTS 硬规则 9 的现场形态）。
  顺序是根因，不是漏写一句检查：编排主流程里 `reapStaleSession` 在「上一位 launcher
  还活着」时刻意什么都不做，而端口归属检查 `reconcilePort` 排在依赖补装**之后**几十行
  ——所以拉到更新后带着活实例重启时，`pnpm install` 会直接去动被活进程锁着的
  `node_modules`。后果不是一句警告：EPERM 失败会连带后续每一条 pnpm 命令一起失败，
  现场表现成「这个仓库忽然装不上也起不来」，按 §13.6.3 的口径还会被误读成
  「本机跑不了门禁」。现在补装前先拦、并给出可执行出口（关窗口 → 下次启动自动接着装）。
- **`sync-lint.ps1` 原先那份端口探测有两处不对**（同批收掉）：它用
  `Get-NetTCPConnection` 裸探「端口有没有人监听」，一是判不出归属（隔壁检出占着同一个
  端口并不会锁本检出的 `node_modules`，那样会在多检出并行下天天误拦），二是**警告完照样
  装**；并且它是「同一件事在 `.ps1` 与 `.mjs` 两侧各有一份实现」的形态（规范 §9 / §9.5）。
  现在这个字面量在 `scripts/sync-lint.ps1` 里一个字都不出现，判据转交上面那份共享实现，
  入口只负责转交与透传退出码。

## 刻意没做的事（写清楚，别当成已完成）

- 没在应用内控制台加「危险命令黑名单」：`docs/guide-console.md` 已签字「刻意不做黑名单」，
  边界是本机 + 有会话的用户。这条规则在控制台那条路上仍是**文档约束**——控制台运行在
  dev server 自己里面，端口永远是被占的，拿它作信号只会自指。
- 没改 `scripts/prepare-local-run.ps1`（双击 `run-local.ps1` 的首次初始化路径）：它是
  「第一次在这台机器上跑起来」的入口，此刻通常没有活实例；要接同一个判据只差一步，
  留给下一次连同它的 `--force` 语义一起定。
- 没为硬规则 4 / 15 造判据（一条是语义判断、近似判据会误报一片；一条原理上不可观测）。
