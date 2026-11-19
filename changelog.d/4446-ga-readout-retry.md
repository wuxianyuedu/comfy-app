## Fixed

- GA 判决回读格：单次请求异常不再终止整个 70 分钟轮询。读数请求补 30s 墙钟预算
  （`AbortSignal.timeout`），网络类失败按退避阶梯（复用 `RETRY_BACKOFF_MS`）在预算内
  续轮，连续 3 次仍发不出去才落「没判过」——fail-closed 方向不变，不再让一次抖动
  丢掉剩余预算把 PR 拦红。（#4446）
