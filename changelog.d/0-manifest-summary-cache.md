## Fixed

- **设置页每次请求都重读解析 manifest（`src/app/api/custom-nodes/route.ts`）**：
  `readManifestSummary` 每次 GET 都 `readFileSync` + `JSON.parse` 整份
  `customNodes.manifest.json`（自定义节点包一多就是几百 KB），而文件只在 parse /
  流式解析收尾时被写。现在按 `(size, mtime)` 指纹缓存摘要 —— 写入后指纹必变、缓存
  自然失效，读取失败不缓存。
