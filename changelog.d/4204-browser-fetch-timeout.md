## Fixed

- **浏览器侧 fetch 统一默认超时**（#4204）：新增 `~/lib/network/fetch-with-timeout`
  （默认 15s，可用 `timeoutMs`/`signal` 覆盖），并把 14 个浏览器模块的 21 处
  `fetch` 机械迁移过去（`log-file-client` 的 2s 轮询链、素材/尺寸配置/画布上传、
  工坊草稿与生成日志、production、debug-source、bgm、update-check、agent 等）。
  此前这些请求没有任何超时：应用服务一旦「不回包也不拒连」，对应连接被永久
  占用——HTTP/1.1 每 host 6 条，正是 #4196 那次探活被饿死的连接池形态。
