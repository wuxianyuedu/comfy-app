## Fixed

- **dev server 就绪等待固定 1s 轮询、每轮写状态文件（`scripts/dev-launcher.mjs`）**：
  就绪等待最多 180 轮，每轮一次探测 + 一次 `launch-status.json` 写盘。现在
  轮询按「前 10 次 1s → 30 次前 2s → 之后 3s」退避（快速冷启动大多几秒内就绪，
  感知延迟只出现在冷编译后段），状态文件每 5 轮写一次；总超时仍是墙钟 deadline，
  退避不会缩短它。
