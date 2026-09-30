## Fixed

- **日志筛选「调试」档不可切换**：`LogFilterBar` 的 `ToggleGroup` 回调白名单漏掉 `debug` 级别，点击「调试」页签时新值被丢弃、`setFilter` 不执行，无法切换。证据：`src/components/studio/logs/LogFilterBar.tsx`。
