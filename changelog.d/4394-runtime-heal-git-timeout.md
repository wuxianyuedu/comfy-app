## Fixed

- **runtime-heal 的 git spawnSync 补超时**（#4394）：两处 `spawnSync("git", …)`
  无 timeout——git 被安全软件 / 网络盘 / 钩子挂起时 launcher（含启动主路径上的
  readGitHead）无限期阻塞。补 10s 预算，与同文件族其它 spawn 对齐；超时按
  「取不到读数」处理。
