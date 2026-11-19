## Fixed

- **日志写线程启动失败不再 panic**（#4392）：`LineLog::spawn` 原先
  `.expect("日志写线程启动失败")`——线程创建失败 = 壳当场崩溃（windows_subsystem
  下无声）。降级为「入队即丢」的断开通道：诊断面损失，壳照常运行，与
  `tcp_probe_bounded` 对 spawn 失败的宽容取向一致。
