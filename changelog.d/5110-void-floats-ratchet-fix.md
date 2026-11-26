## Fixed

- **补队列刷新 `fireAndForget` 修复的回归用例（ISSUE #5110）**：`comfy-queue-store` 的 `refreshComfyQueue()` 去重标记清理已改走 `fireAndForget`（见 #5111/#5112）；本条补一条失败路径回归用例，锁定「请求失败后清理链仍释放去重标记、下一次调用可立即重试、且不产生未处理 rejection」这一契约 —— 清理漏掉失败分支时该用例会红。
