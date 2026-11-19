## Fixed

- **反馈提交路由的 Turbopack「全项目追踪」告警清零（#3492）**：`src/app/api/feedback/publish/route.ts`
  的 `path.join(LOG_EXPORT_DIR, packageName)` 把 `/*turbopackIgnore: true*/` 注解放到了整个
  `path.join(...)` 之前（不在被高亮的表达式上），Turbopack 仍把整项目（28602 个文件）纳入 tracing，
  报「overly broad pattern」与「tracing of the whole project」两条告警。按
  `docs/standards/launch-and-build.md` §7.2「注解必须落在被高亮的表达式上」，把注解移到 `path.join`
  的第一参数前（`packageDir` 与 `issue.md` 两处同改）；本地 `next build` 复测：`Compiled successfully`、
  两条告警均消失。
- 顺带核实评论区两个担忧：`LOG_EXPORT_DIR = path.join(process.cwd(), "log", "exports")` 在运行期
  恒为字符串，告警里的 `/null` 只是构建期静态分析对 `process.cwd()` 的未知占位，**不是**运行期
  把反馈包写进 `null` 目录；反馈包名校验 `^feedback-\d{8}-\d{6}-\d{3}$` 已把 `/`、`\`、`..` 全部挡住。
