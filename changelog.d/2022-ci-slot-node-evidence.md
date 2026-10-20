## Fixed

- **订正一处「只在用户身份上实测过」的残余**（ISSUE #2022 第二步，规范 §13.5.3.4.3）：
  槽内那次 `pnpm install` 解析到的 store 与作业里那次是否同一个，此前没有节点上的证据。
  #2050 的 runner 日志自己回答了：`Content-addressable store is at: F:\.pnpm-store\v11` 与
  `Packages are hard linked from the content-addressable store to the virtual store`，
  而 `fsutil hardlink list` 对槽里一个 `package.json` 数出 9 个链接名（store + 各并行检出 +
  `F:\runner\ci-cache\…` 那一条）。⇒ LocalSystem 这个 profile 用的就是同一个 store，
  「一个键净占约 52 MiB」这个配额前提是**节点形态**，不是本机外推。

## Added

- **节点上的第一手读数**：槽内冷装 `Done in 1m 9.2s`（同日普通装那一格是 76.9s）。
  这两个数在本碎片里**不做因果** —— 差 7.7s 最像的原因是槽里的 `package.json` 摘掉了
  `scripts`、因此不跑本仓那几条 postinstall，但没有钉住其余变量的对照，所以它只写成一个
  待验的解释。`.cnb.yml` 里「目录不在不影响读数」那句也顺手加了牙齿：执行档曾被
  `fs.statfsSync` 对不存在的路径抛 `ENOENT` 判成「盘不够」而永久回退（#2049 空转、#2050 修），
  现在槽根真的在盘上，读数与事实可对账。
