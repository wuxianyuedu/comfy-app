## Fixed

- `runFFmpeg` 的 stderr 无上限累积：异常 ffmpeg（坏片循环告警）输出 GB 级 stderr 会顶到 OOM（#4228）。改尾部收集器（分片淘汰最旧，摊销近似 O(n)）——ffmpeg 的结论在最后几行，progress 刷屏在前；上限 256K 与 cnb-cli 同档。收集器独立成 `createStderrTailSink` 纯助手可单测。用例：超限保尾、不超限一字不丢。
