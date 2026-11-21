## Fixed

- **合并前复算的 600s 上限不再把「慢」无声判成退 2（#4662）**：现场进度行是「本检出:eslint」—— 上限罩的是整个 `premerge-check` 子进程（本检出 + 干净快照两侧、四段），不是只罩快照；共享机上 type-aware oxlint 可能 healthy-but-slow（正常 7–10 分钟，并发负载下 30 分钟以上），600s 到点把「慢到没跑完」压成 exit 2，push 被卡。`premerge-proof.mjs` 现在导出 `recomputeTimeoutMs()`，`COMFY_PREMERGE_TIMEOUT_MS=<整数毫秒，≥60000>` 可显式抬预算（非法值退 2 并点名，抬升本身也在 stdout 念出来），退 2 的话术同时点明「抬预算」与「手工 `--light` 交给平台」两条出口；两条都不伪造绿。规范 §13.6.2.1 同步写清「上限罩整个子进程」与两条出口，并纠正「只罩快照」的误判。用例钉住默认值 / 合法值 / 非法值与话术。
