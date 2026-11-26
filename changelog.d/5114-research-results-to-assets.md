## Added

- 脸库 / 风格库的生成成品可一键加入资产库（#5114）：两页结果卡新增「加入资产库」按钮，
  复用历史页同一个归属 / 分类 / 子目录弹窗；本地工作流通道带 taskId 走既有
  `asset.createFromTask`（参数快照来自任务行）；远端 API 通道没有任务行，新增
  `asset.createFromUrl`——服务端经统一 `safeFetch` 的 SSRF 判据安全下载图片、校验类型与大小，
  写进 `generated/assets/<assetId>/` 后按既有资产行落库。入库成功后失效 `asset.list` 缓存。
  同批补落盘 / 路由 / hook / 两页视图用例；产品文档新增 FR-AL-06。
