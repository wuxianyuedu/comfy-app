## Fixed

- comfy 状态长轮询失败无退避：后端不可达时毫秒级失败请求热循环（每秒几十发，撞同源连接预算 ERR_INSUFFICIENT_RESOURCES）（#4234）：`pollOnce` 返回值区分「健康无变化」与「请求失败」，失败走新增具名策略 `COMFY_STATE_POLL_BACKOFF`（指数 + equal 抖动，封顶 15s），健康路径「立即重发」的长轮询语义不变。用例：退避决策表（注入确定性 rand）、失败期 60s 请求密度有界、恢复后立即重发。
