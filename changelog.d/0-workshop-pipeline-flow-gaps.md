## Fixed

- **工坊制作流程的一批可靠性欠缺**（六阶段主干不变，补「失败出口 + 状态恢复」短板，规范 10 §10.3.1「降级不得静默」）：
  - **定妆照会话锁泄漏**（`src/components/workshop/hooks/use-character-portrait.ts`）：
    `generate` 的两条门禁早退（提示词为空 / 本地通道未选工作流）与 `importFile` 的
    「非图片文件」早退都在 `taskLock.tryEnter()` 之后直接 `return`，单飞闸门被永久
    占住 —— 之后所有生成 / 导入静默无响应（「点了没反应」）。改为拿到锁后的每条
    路径都走 `finally` 归还，并删掉 `importFile` 里一次多余的 `tryEnter()`。
  - **剧本导入失败清空剧本**（`src/components/workshop/WorkshopStageBody.tsx`）：
    读取 .md/.txt 失败时旧实现把 `scriptMarkdown` 覆盖成空串，一个坏文件毁掉整份
    剧本。改为保留原内容，并经控制器新增的 `showNotice` 上屏说明（空文件同样提示）。
  - **分镜批量生成永久卡死风险**（`src/components/workshop/hooks/use-workshop-pipeline.ts`）：
    控制器 `generateShot` 的任务观察循环没有超时阀（镜头生图 / 视频生成两处各有
    30 分钟安全阀，唯独分镜批量走的这条没有），SSE 流沉默时批量循环卡死。
    补齐同口径安全阀，常量统一为 `generation-client` 的 `LOCAL_TASK_TIMEOUT_MS`。
  - **刷新后进行中任务失联**（同上）：`Shot.taskId` 随草稿持久化，但观察循环活在
    内存里，重挂载后镜头永远停在「生成中」。挂载时先查 task 表真值
    （新增 `fetchTaskSnapshot`）：已成功直接回写产物、已失败按失败收尾、仍在跑才
    重订阅 SSE（SSE 对订阅前已终态的任务只回放 state 帧、不带产物，无脑重订阅
    会把已成功的任务判成「连接中断」）；回写核对 `taskId` 归属，不覆盖恢复期间
    重新发起的新任务。
  - **「给了值却没生效」静默丢输入**（封装层三处调用点）：
    `buildLibraryWorkflowInput` 返回的 `unmatched`（未落到任何工作流端口的口）
    此前在控制器 / 镜头生图 / 视频生成全部被丢弃。新增共享翻译
    `describeUnmatchedInputs`（契约口 id → 用户口径文案），三处在发起前上提示条。
  - **错误提示 4 秒自灭**（同上）：工坊提示条写入的都是错误 / 门禁 / 未生效警告，
    自动消失曾让失败原因来不及读。改为常驻 + 手动关闭。
