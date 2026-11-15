## Fixed

- `server-cache` 增加 per-key single-flight 与失效代次比对（#3874，审计源 #3848）：并发未命中只构建一次；构建期间被 `cacheDel`/`cacheDelPrefix` 失效过的结果不再回填，PATCH 后 30s 内不再读到旧详情。
