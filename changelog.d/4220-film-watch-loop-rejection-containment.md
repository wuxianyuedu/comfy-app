## Fixed

- film 监看循环 rejection 无兜底，瞬时 SQLITE_BUSY 可打崩整个 Next 进程（#4220）：`watchLoop` 外层收口为「判失败 + 行日志留痕」（`markFailed` 是条件更新，不覆盖用户终态），收口动作各自再兜一层防二次抛；`startFilm` 与恢复扫描两处调用点改走 `fireAndForget`，交接重读失败让位退场。用例：mock 监看首拍炸 SQLITE_BUSY，断言影片落 FAILED + 留痕 + 在飞表清空、rejection 不冒出。
