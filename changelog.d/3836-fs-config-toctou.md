## Fixed

- **文件与配置层的「检查/读取 → 写入」补上原子性或防重入**（ISSUE #3836，跨三个 PR 落地）：
  - 素材上传落盘改 `wx` 独占创建：并发上传同名文件不再后者覆盖前者（「重名不覆盖」
    由机制兑现）。
  - LLM 密钥文件改 `wx` 独占创建：Next server 与 Workshop MCP 双进程首启不再各写
    一个随机密钥导致跨进程解密静默失败。
  - 成片日志（JSON 列读-改-写追加）按影片 id 进程内串行化：监看与合成同时打日志
    不再互相覆盖丢行。
  - 成片手动「开始生成 / 重新合成」改条件抢占置位（`claimGenerating` /
    `claimComposing`）：双击不再给每镜头排两批视频任务、不再两个 ffmpeg 踩同一个
    输出目录。
  - launcher `shutdown` 加进程级重入守卫：信号与正常收尾并发时不再双跑回收。
  - `saveSettings` / `saveWorkshopApiSettings` 进程内串行化；工坊 API 通道配置的
    进程内缓存补文件指纹失效（另一进程的写入不再永远读不到）。
  - `writeSession` 复用 `run.mjs` 的 `writeJson`（rename 短暂重试）：Windows 上
    并发启动不再因 rename 撞车把会话锚点留在旧内容。
