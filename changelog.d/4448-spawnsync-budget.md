## Fixed

- 探测 / 编排类的 `spawnSync` 补墙钟预算：console-encoding、env-probe（60s），
  premerge-proof 的 git 读Revision（30s）、门禁脚本执行（10 分钟兜底）、remote 清单
  （30s）。子进程挂死（杀软扫描 / 挂起的 lock / 管道阻塞）时不再无限等，`status === null`
  按三态口径的「没跑起来」分型，不冒充成功。（#4448）
