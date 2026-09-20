## Added

为本地生成任务的客户端订阅层（`watchTask`，覆盖工坊镜头生图 / 视频 / 角色定妆 / 画布预览 / 封装流程测试共 8 个入口）补充决策点诊断日志：

- 订阅建立、收到 `state`/`done`/`error` 终态帧、落定判定与原因、连接中断与主动关闭均留痕；
- 记录「非失败终态（尤其 SUCCEEDED）到达却不落定」这一此前完全不可见的关键缺口；
- 每条日志同时写入应用日志面板（`console` 拦截）与工作流库「执行日志」弹窗时间线（`src: "client"` 标记来源），两端都能定位「日志显示已完成、界面却一直卡在生成中」。

`generation-client.ts` 首行标 `"use client"`（本模块只用 EventSource / fetch，只在浏览器跑），「日志唯一通道」门禁据此把这里的 console 与**服务端**直写区分开（服务端直写会绕开脱敏与 ERROR 镜像）；豁免由 `tests/single-logger-channel.test.ts` 的正向后置断言锁住。

不改动任何判定逻辑。
