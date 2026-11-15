## Fixed

- ComfyUI 任务成功收口与产物行写入收进同一 immediate 事务（#3881，审计源 #3848）：`createImages` 失败不再留下「SUCCEEDED 但 0 行产物」的半态——任一失败整体回滚，任务保持 RUNNING 由回收器下一轮对账。
