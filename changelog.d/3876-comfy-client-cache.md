## Fixed

- ComfyUI 客户端缓存竞态两处（#3876，审计源 #3848）：`fetchObjectInfo` 增加在途去重（并发未命中共享同一次 ~4.7MB 拉取）且非 2xx 与网络失败同口径进 30s 负缓存；`probeComfyBase` 的会话缓存回滚改为判等——只回滚本次探测链写入的值，不再践踏探测期间第三方（uploadImage/interrupt）刚写入的新发现。
