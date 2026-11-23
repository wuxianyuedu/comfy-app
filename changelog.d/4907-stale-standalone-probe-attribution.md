## Fixed
- `tests/turbopack-tracing-excludes.test.ts` 的产物级探针补「产物新旧」归因（#4907）：命中排除对象时，按 `.next/standalone` 与 `next.config.js`（排除清单的住处）的 mtime 分两路——产物早于配置 ⇒ 失败信息明确写「【产物过期】旧构建残留，重跑 pnpm build 再判」；不早于 ⇒ 才归因为「outputFileTracingExcludes 失效或漏项」。此前陈旧产物会把「历史构建的泄漏」伪装成「现行判据失效」，误导排障方向。判据不放宽：现行构建漏排仍照红。
