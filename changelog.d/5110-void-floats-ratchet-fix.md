## Fixed

- **修复 PR #5070 队列刷新清理链触发 src/lib void 悬空棘轮导致 CI 判红（ISSUE #5110）**：`refreshComfyQueue()` 的 settled 清理从 `void pending.then(…)` 改为 `fireAndForget(pending.finally(…))`，消除新增的 `void someFn()` 语句形态（H-6 `check-void-floats` 棘轮回到基线 0）；并发去重、失败 reject 与可重试契约不变，清理链在成功与失败两路都释放去重标记且不产生未处理 rejection。
