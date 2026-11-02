## Fixed

- 「类型检查」那一格现在会把**判决面**念出来（ISSUE #3041）：`scripts/ci-run-tool.mjs`
  起 `tsc` / `tsgo` 时在子进程跑完后追加一行 `[ci-run-tool] 判决面：<tsconfig 路径>（tsc 默认（cwd 的 tsconfig.json）| 点名；include: …）`——
  `tsc` 不带 `-p` 用的是 **cwd 的 `tsconfig.json`**，这件事只存在于 tsc 的默认行为里，
  平台日志上看不见；#2990 的六条报错「只在平台显形」时，第一问就是「两边判的是不是同一份面」。
  include 摘要按 JSONC 读（小状态机剥注释，`"~/*"` 这种 glob 字符串里的 `/*` 不会被当注释吃掉），
  读不到就落「内容读不到」，是读数不是判据。「实际执行」一行同时补上**版本标签**
  （`（typescript@7.0.2）`）—— 别名依赖之下只念路径对不出「两边是不是同一份编译器」。
  用例在 `tests/spawn-shell-scan.test.ts` 的 ci-run-tool 段（点名 / 默认 / 非 tsc 不念 / glob 不碎）。
- `scripts/check-oxlint-zero-rules.mjs` 在 Windows 上改直起包真身（ISSUE #3079 的 spawn 一半）：
  原来是 `spawnSync(node_modules/.bin/oxlint.cmd, { shell: true })` —— `.cmd` 只有 cmd.exe
  解释得动，挂 `shell` 撞的是 Node 26 的 DEP0190，`tests/spawn-shell-scan.test.ts` 的
  「scripts/** 里没有起子进程开 shell」在 master 上当场红。改成
  `resolveBinEntryByName("oxlint")` + `spawn(process.execPath, [entry, …])`（#2572 同一条路）。
  改完后该判据在 Windows 上第一次跑通全仓档，随即显形 12 处 #3016 规则集的存量回潮
  —— 那一批已立案 #3079，不在本笔处置。
