## Fixed

- **订正一处「只在用户身份上实测过」的残余**（ISSUE #2022 第二步，规范 §13.5.3.4.3）：
  槽内那次 `pnpm install` 解析到的 store 与作业里那次是否同一个，此前没有节点上的证据。
  #2050 的 runner 日志自己回答了：`Content-addressable store is at: F:\.pnpm-store\v11` 与
  `Packages are hard linked from the content-addressable store to the virtual store`，
  而 `fsutil hardlink list` 对槽里一个 `package.json` 数出 9 个链接名（store + 各并行检出 +
  `F:\runner\ci-cache\…` 那一条）。⇒ LocalSystem 这个 profile 用的就是同一个 store，
  「一个键净占约 52 MiB」这个配额前提是**节点形态**，不是本机外推。

## Added

- **节点上的第一手读数（同日三档 + 一条普通装对照）**：#2049 那跑因执行档把「槽根还不存在」
  读成「盘不够」而空转，日志里紧跟着就是那条普通装 `Done in 51s` —— 它顺手成了同机同日的对照臂；
  #2050 第一次为该键建槽 `Done in 1m 9.2s`；#2051 命中，整步 ≈2s（`00:00:54` 判 `reuse` →
  `00:00:56` `✓ 走缓存槽（reuse）：作业侧 .git/config 那笔已补`）。⇒ **未命中比不建槽贵 18s**、
  命中省 ≈49s，盈亏平衡是「每个键至少命中一次」；这三个差值是跨构建读数（三条构建的内容与负载
  都不同），当日量级而非精确系数。`.cnb.yml` 里「目录不在不影响读数」那句也顺手加了牙齿：执行档
  曾被 `fs.statfsSync` 对不存在的路径抛 `ENOENT` 判成「盘不够」而永久回退（#2049 空转、#2050 修），
  现在槽根真的在盘上，读数与事实可对账。
