## Fixed

- ComfyUI 派发循环的「槽位检查 → 领取 → 记账」整段用进程内互斥串行化（#3873，审计源 #3848）：常驻 tick 与 `kickQueue` 并发进入不再突破 `MAX_CONCURRENCY`。
