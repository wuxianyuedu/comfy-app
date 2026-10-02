## Fixed

- **日志面板「应用服务」一路一条也不显示**（ISSUE #1365）。根因是**「取最新一份转录文件」按文件名排序**，而文件名是 `nextjs-panel-<pid>-<毫秒>.log`、`pid` 是变长十进制——字典序比较的是字符而不是数值，`…-9876-…` 排在 `…-12345-…` 之后，于是「排序后最后一份」实际落在**某次更早运行**留下的文件上。那份文件的时刻早于本次会话起点，被 `dropStaleEntries` 整批裁掉，这一路就成了恒空的来源（面板上只剩「—」，而别的来源照常）。
  - 取最新改按 **mtime**，唯一事实来源是 `src/lib/capture-streams.server.ts` 的 `latestPanelLogFile()`——路由 `source=app` 与轮转两处都问它。与启动器侧 `latestPanelTranscript()`（纯 Node 宿主，import 不了 TS）同一口径，由用例钉住两处一致。
  - 顺带修掉同一模块的**轮转失效**：按 `bootId` 前缀找「同族」永远只匹配到自己那一份（`bootId` 每次都不同），于是一份也删不掉、转录文件每次启动后无限累积——而旧文件越多，「取错最新一份」越容易踩中。现在按 mtime 跨 boot 保留最近 5 份。

## Tests

- `src/app/api/logs/current/route.test.ts`：`source=app` 按 mtime 取最新一份，不按文件名字典序（用「pid 更大、名字更小、mtime 更新」的夹具，反向验证时在旧实现上必红）。
- `src/lib/log/capture-streams.server.test.ts`：`latestPanelLogFile()` 的 mtime 口径与目录缺失返回 null；轮转按 mtime 跨 boot 保留最近 5 份（6 份不同 bootId 的历史里，最老的那份被删、最新的历史还在）。

## Docs

- 规范 07 §7.23.1 增一条告警：**「取最新一份」只能按 mtime**，附文件名排序读错的方向与后果；§7.18.2 与 §7.23.1 的来源表同步改口径。
