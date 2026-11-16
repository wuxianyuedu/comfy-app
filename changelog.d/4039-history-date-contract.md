## Fixed

- **画布历史面板恒空（#4039）**：`task.list` 行的 `createdAt` 是 drizzle
  `dateNotNull` 产出的 Date，经 tRPC 的 superjson transformer 到浏览器仍是
  Date 实例；历史面板的镜像判据 `historyTaskRowSchema` 却判 `z.string()`——
  每行 `safeParse` 失败、整行丢弃，`fetchHistoryTasks` 恒返回 `[]`，面板无
  报错地空着。镜像改为 `string | Date` 双形态收、归一成 ISO 字符串；钉契约
  的 wire 测试改用 superjson 往返建模真实传输（旧注释「Date 变字符串」与
  `src/trpc/link.ts` 的真实配置相悖）。接口契约与兼容审计 #3907 的 P1 项。
