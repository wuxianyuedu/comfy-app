## Fixed

- 用户可见的时间输出统一按本地（北京）时区展示，存储与机器可读格式保持 ISO UTC（#4654）：`ship --result` 的事件时间线与起止时刻、`ship --fetch-issue` 落盘正文的创建 / 更新 / 抓取时间、coverage-readout 的报告 mtime、freshness 台账的「上一次跑绿」、typedoc-run 的探测读数、probe-lock-readout 的起止时间、CHANGELOG 并入的日期行；`event-loop` 阻塞消息里的恢复时刻由裸毫秒戳改为本地时间戳。scripts 侧统一复用 `launcher-core/log.mjs` 新增的 `localStampOf`（解析不了原样回落）。
