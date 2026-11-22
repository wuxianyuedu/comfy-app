## Fixed

- **媒体下载中止路径未取消上游流，socket 被悬挂占用（#4726，#3897 的子项）**。
  `saveMediaToLocalTemp` 流式落盘时，超限或写盘失败提前退出只关了文件句柄，
  没有 `reader.cancel()`：fetch body 未被消费也未取消，上游连接被无人读取的
  socket 占住直到超时/GC，反复触发（如反复生成超限视频）会累积悬挂连接。
  现在仿照同族点 `api-channel`（#4218）的收口：`finally` 里先
  `reader.cancel()` 再 `releaseLock()`，正常读完时 cancel 是无操作。
  回归用例钉住「超限中止 / 上游中途出错 / 正常读完」三条路径都取消上游流。
