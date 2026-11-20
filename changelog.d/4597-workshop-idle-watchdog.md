## Fixed

- 工坊观察侧 30 分钟超时实为「总时长」而非「无响应」（#4597）：`withTimeoutResult`
  的定时器从订阅那一刻起跑，健康但总时长超 30 分钟的任务（长视频渲染）会在进度
  仍在推进时被判 failed；服务端任务继续跑并 SUCCEEDED、产物落盘，而客户端已放弃
  ——重新生成 = 同一镜头重复占用唯一执行槽。
  收成 `observeTaskUntilSettled`（generation-client）一处：进度 / 日志 / 产物帧都算
  「有响应」并续期定时器，连续 30 分钟静默才触发；触发时先查任务真值
  （`fetchTaskSnapshot`）对账——任务其实已 SUCCEEDED 就采纳产物回写，只有确认
  仍未终态才按失败收尾。ShotStudio / VideoStudio / use-workshop-generation 三处
  观察循环统一改吃它。
