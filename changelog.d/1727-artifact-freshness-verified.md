## Fixed

- **产物级护栏那一档的账从「豁免」换回「实跑凭证」**（ISSUE #1727 收尾）。`8286ac7a`（#1732）当天把 `scripts/.artifact-freshness.json` 的 `verifiedAt` 往前推，同时补了一条 `skippedReason`（「两次完整 `next build` 均在约 10 分钟被本机环境以信号终止」）——按 `scripts/freshness-ledger.mjs` 的形状，`skippedReason` 在场只表示「有人回答过为什么不跑」，**不是「这一档跑绿过」**（`writeFreshness()` 整块替换记录、新对象里没有这一栏）。同一个形态 #1727 已在 e2e 那档核过一次（`4ce9e871` 声称换账、实际逐字节没换），这是同一件事落在产物档上。
  - 现在真跑 `pnpm run build` 跑绿后记账：`skippedReason` 不在了，`verifiedAt` 是本次读数，`who` 是本次跑它的那个人。三份账（`e2e` / `full` / `artifact`）至此**全部是真凭证、无一豁免**。
  - 顺带记一条与那句豁免矛盾的读数：**构建本身的耗时不是十分钟量级**。本次 `next build` 编译 **21.7s**、整条链（含剥私有输入 + 数产物 + 宿主冒烟）数分钟量级就跑完了 —— 上次卡到 10 分钟被信号终止更像**环境/孤儿进程**那一格，不是这条链该有的成本。下一个人遇到「build 卡住」时可据此先看进程残留，别默认它是慢。
