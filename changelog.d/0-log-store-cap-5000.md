## Added

- **应用日志时间线恢复内存上限（5000 条）+「更早 N 条已折叠」提示**：`log-store` 此前刻意去掉了 2000 条环形缓冲、时间线无上限（长期开着 + 三路轮询会让 `logs` 数组无界增长）。现按用户定的 5000 条上限恢复：`appendFileLogs` / `addEntry` 在 `mergeTimeline` **之后**用 `capTimeline` 裁到 `LOG_STORE_MAX`，被折叠的更旧条数累计进新的 `droppedTotal`，`LogPanel` 页脚在 `droppedTotal>0` 时显示「更早 N 条已折叠」（完整历史仍在磁盘日志文件）。`clear()` 归零。

> 严格遵守文件早先「将来若恢复上限须恢复身份判据」的约束：`revision` 只在 `mergeTimeline` 返回新数组（真有新行落板）时推进，截断发生在其后、不影响该判据（截断本身不算新内容落板）。附三条上限回归测试（裁剪/累计、真全重复不涨、clear 归零）。
