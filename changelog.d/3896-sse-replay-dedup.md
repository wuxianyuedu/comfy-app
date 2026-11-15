## Fixed

- 任务 SSE 重连全量回放 × 消费端去重缺口（#3896）：`/api/tasks/[id]/stream`
  每条新连接（含 EventSource 自动重连）都把全量日志从头回放，而多个消费端
  要么无去重、要么只扫尾部 64 条——重连后整段历史重复、尾窗被重复行占满。
  收口：`page-window` 新增 `tailWindowAppendUnique`（按 keyOf 全窗判重的尾部
  窗口追加，唯一出口），队列日志弹窗、workflow-run-store、stepLogCache、
  角色定妆照日志四处消费端统一改走它；服务端 `stream/route.ts` 的轮询定时器
  改为**回放落定后**再启动（并带 closed 守卫），消掉「回放超 3s 时先以
  sentLogCount=0 全量推一遍、回放完成再全量重发」的竞态窗口。
