## Fixed

- **`discover` 结果缓存没有容量上限（`src/app/api/custom-nodes/route.ts`）**：
  它的键是请求体里父目录列表拼成的字符串（外部可控），而 TTL（5s）**只在读的时候判** ——
  过期条目本身会一直留在 Map 里。现在写入统一走 `rememberDiscover`，超出 32 条按 Map
  的插入序淘汰最早的键；`discover` 与流式版本两个写入点用同一个出口。
