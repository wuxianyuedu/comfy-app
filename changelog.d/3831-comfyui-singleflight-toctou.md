## Fixed

- **ComfyUI 启动单飞锁关掉 TOCTOU 窗口**（ISSUE #3831）：`ensureComfyUiReady` 原先
  「检查 `st.starting` → …… → 秒级进程快照探测 → 才赋锁」，两个并发入口（上传重试 /
  WS 重连 / ensure 轮询 / 设置页按钮）会在探测处先后让出、读到的锁都是空，双双
  spawn —— 两个 ComfyUI 竞争同一端口。现在把「闩锁 / 判决 / 探测 / 拉起」整体收进
  `startOnce`，**同步**赋给 `st.starting`（函数体到第一个 await 前不让出），占锁先于
  任何 await；判定语义与失败闩锁行为逐字保留。
