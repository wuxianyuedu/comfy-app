## Fixed

- **测试生成可见化三件（ISSUE #3791）**：
  - **请求详情面板**：relay 路由接受 `debug` 旗标（测试页带，工坊链路不带、
    行为不变），把**实际发出的每一笔请求**读数随响应带回 —— 端点、请求体
    （长值如输入图 data URL 截断到 300 字符）、HTTP 状态、耗时、响应摘要
    （截断到 600 字符）；生图 / 视频提交 / 视频轮询（逐候选）三路都上报，
    **成功与失败都带**（上游 4xx/5xx 时最需要看到发出了什么）。测试页新增
    「请求详情」分区逐条展示；密钥在请求头，从不进读数。
  - **「打开原始产物」不再报 ACL 错**：桌面壳内 `target=_blank` 外链被壳的
    shell ACL 拦下（Runtime Error: Command plugin:shell|open not allowed）。
    改走全库统一出口 `setting.openExternal`（服务端 `openUrlInBrowser` 交
    系统浏览器，免重编壳），成功 / 失败都有反馈位（`useExternalAction` 样板）。
  - **产物图片进图片查看器**：结果缩略图换 `ViewableImage` —— 点开进
    `ImageViewer`（滚轮缩放 / 适应窗口 / 原始大小），标题栏显示**原始宽高**
    （诉求单第 3 条「要能看到尺寸」）；视频产物保持既有播放器。
  - **同批修正一个 #3778 的漏发**：`apiGenerateImage` 的请求体组装漏了
    `seed` 键 —— 路由解析得到、客户端从未发送，用户在测试页填的种子静默
    丢失；现已随请求体下发（回归用例钉住）。
  - 用例：`api-channel-core.test.ts`（debug 捕获：成功 / 网络失败 / 长值截断 /
    视频提交与逐候选轮询）、`generation-client.test.ts`（onDebug 双路 + seed
    透传回归 + debug 旗标）。
