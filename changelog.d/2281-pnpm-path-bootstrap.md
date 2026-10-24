## Fixed

平台上的「装依赖」这一步现在**先把 pnpm 放回 PATH，再问它起不起得来**（ISSUE #2281）。

同一台自托管节点、同一个时刻：开发者会话里 `pnpm -v` 一直正常（`…\AppData\Local\pnpm`
在 PATH 上），而平台那十几格齐刷刷写「pnpm 不可用」—— 那些格跑在**服务账号会话**里，
它的 PATH 一条也不含 pnpm。两句话都对，所以再补一条判据读不懂这件事：缺的是「把 pnpm
放回来」这一步。

- `scripts/ci-install-deps.mjs` 新增 `ensurePnpmOnPath()`：按「PATH 上本来就能跑 →
  corepack 落点（`%LOCALAPPDATA%\node\corepack\v1\pnpm\<ver>\pnpm-native.exe`）→
  pnpm 自己的落地目录」的顺序找，每个候选都**真起一次 `pnpm -v`** 复核。
  它只做发现，不联网、不安装；哪儿都没有就如实报「问过哪几处」，并以 1 退出。
- `check-pnpm-available.mjs` 在同样的情形下点名 corepack 落点与那条临时拼接命令 ——
  此前只给 `corepack prepare`（要联网下一整套），而机器上其实已经有一份能跑的。
- 读盘与起进程都可注入：`tests/ci-install-deps.test.ts` 在 POSIX 上判 Windows 的形态，
  钉住「本来就能跑就不动 PATH」「起不来的候选不许当选」「哪儿都没有就不装」三条。
