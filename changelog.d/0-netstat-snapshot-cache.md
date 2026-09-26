## Fixed

- **三个端口探测跑三遍同一个 netstat（`scripts/launcher-core/procs.mjs`）**：
  `scanPorts` 对相邻三个端口各调一次 `listeningPidsOnPort`，Windows 侧每次都起一个
  `netstat -ano -p TCP` 子进程 —— 而它的输出覆盖**全部**端口，三遍完全相同。现在
  netstat 原始输出按 1s TTL 快照缓存，并发调用合并为同一次在途探测（一次子进程）；
  探测语义（「这一瞬间谁在听」）不变，POSIX 侧读 `/proc` 本就便宜，不缓存。
