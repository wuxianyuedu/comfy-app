## Fixed

- **日志中继不再在渲染期写 store**（#4919）：console.* 的日志中继改为「入队 → 轮询回调排空」（新增 `console-relay.ts`，队列封顶 1000 条）——任何组件渲染期触发的 console 调用都不再引发渲染期 setState 更新 LogPanel（React 的 set-state-in-render 禁则；微任务中转在并发渲染让出窗口里仍会踩线，故弃用）。打印时刻在入队时定死，入库沿用，面板可见延迟与既有 2s 轮询一致；`addEntry` 支持可选 `time`。顺带补上 `view-tabs.spec.ts` 轮询处缺失的 no-await-in-loop 豁免注释（#4946 遗留）。
