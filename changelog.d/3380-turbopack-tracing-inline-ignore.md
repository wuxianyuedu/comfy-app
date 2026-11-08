## Fixed

- **构建期「全项目追踪」告警清零（#3380）**：把 `turbopackIgnore` 注解从失效的
  `tracingIgnoreArgs()` 跨模块展开改为**写在被高亮的表达式上**（`fs.*` 的第一参数 /
  `path.join` / `path.resolve` 的参数列表）。Next 16.4.3 + Turbopack 实测：同一份
  `next build` 的告警数由 52 降到 0，`.next/standalone` 不再因这些运行期动态路径被
  放大追踪；产物层清理仍由 `standalone-private-inputs.mjs` 负责，最终产物内容不变
  （`check-standalone-contents` 通过，2939 个文件）。删除已无消费者的
  `src/lib/shell/tracing-ignore.ts` 与其测试，并同步规范 §7.2 与文档镜像。
