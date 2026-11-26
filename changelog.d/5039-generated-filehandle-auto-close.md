## Fixed

- **产物文件流不再留下未关闭的 FileHandle（#5039）**：`GET /api/generated/[...path]`
  的整档分支此前 `fs.promises.open()` 后把 close 全压在 Web 流的 pull/cancel 上，
  响应体既没被读到底也没被 cancel 时（客户端提前断开、流被 GC），句柄无人关闭，
  Node 26 的 GC finalizer 抛 `ERR_INVALID_STATE` uncaughtException。改走路径式
  `createReadStream({ autoClose: true, signal: req.signal })` 并 `Readable.toWeb()`
  包装：fd 由 Node 流在 end/error/destroy 时确定性释放，请求断开信号传到真正
  干活的流，且这一路不再产生 FileHandle 对象。回归用例钉住「响应体从未被消费
  也释放」与「整档分支不再 open FileHandle」，其余 open 调用点（Range 分支、
  logs 三路由、video-task-util）复核已全部显式关闭。
