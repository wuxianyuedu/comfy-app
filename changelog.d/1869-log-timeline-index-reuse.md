## Changed

- **日志面板时间线合并：去重索引跨轮复用（每轮重建两张全表 Map → 只在形状变化时建）**（ISSUE #1869 性能轮次）。面板六路轮询每 2s 各写一次时间线，而 `mergeTimeline` 原本**每轮**都对整条时间线建 `entryKey` / `arrivalKey` 两张 Map——只为判出这次送来的一两行是不是新的。5000 条上限下实测这一点占整次合并的 **97%**（2.27ms / 2.34ms，排序只占 0.11ms）。
  - 新增 `TimelineIndex`（两张表）与 `buildTimelineIndex` / `mergeTimelineIndexed` / `trimTimelineIndex`；索引按**数组引用**缓存在 `log-analysis` 的 `WeakMap` 里，`mergeTimeline` 与 store 的两条写入路径（`addEntry` / `appendFileLogs`）都走索引复用版。
  - 截断（`capTimeline`）改**摘键**而不是重建：`trimTimelineIndex` 只摘真出窗口的那一条（按引用比对，同 key 仍有副本留在窗口里时不摘），O(被折叠条数) vs 重建的 O(时间线)。不摘键会让出窗口的行永远不被补回，与截断语义不符。
  - 无索引的 `mergeTimeline(current, fresh)` 签名与行为**逐字不变**（内部自己建一次索引），一次性调用方与既有测试不受影响。
  - **实测**（5000 条上限、逐行追加 200 轮）：单轮 5.127ms → 3.046ms（约 1.68×，省下约 2.1ms/轮；六路每 2s 一轮约省 6ms 主线程）。改动只消除「判重建表」那一半，`computeCounts` / `computeFiltered` 等派生计算的开销不在本次范围内。

## Tests

- `log-store.test.ts` 新增 5 条：索引复用版与「每轮重建」在整段序列上逐字一致（含乱序时刻 / 同秒副本 / 跨来源同一行）；截断摘键后仍与「按保留段重建」一致（出窗口的行会被重新补进来，仍在窗口的重投仍被丢弃）；**截断摘键只摘真出窗口那一条**（同 key 副本仍在窗口时不摘）；**同一秒副本行并进已落板那条的 origin**（既有语义的直判据）；**索引被跨轮复用**（`vi.spyOn(Map.prototype.set)` 计写表次数，判据不靠临界值）。
- 四处变异逐一核过：把 `appendFileLogs` 换回 `buildTimelineIndex(state.logs)` → 复用那条红；`capTimeline` 不摘键也不搬索引 → 复用那条红；`trimTimelineIndex` 去掉引用比对 → 摘键那条红；去掉「并 origin」那一步 → 副本 origin 那条红。前两条恰是「只断言行为等价」看不见的——等价性用例在退回重建时**全绿**，而性能就是这次改动的全部目的。
- 受影响面 20 份用例 / 460 条全绿（`src/components/studio/logs`、`src/lib/log`、`src/lib/page-window`）。
