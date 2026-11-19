## Fixed

**每日档「全量E2E」主链路红：project.upsert 入参键没跟上 #4049 的改名**

#4049（#4090，2026-11-16 落地）把 `project.upsert` 的入参键从 `id` 统一成
`projectId`，`e2e/main-journey.spec.ts` 没同批跟上——仍送 `id`。zod 判缺必填项，
而 tRPC 的 JSONL 流式响应把错误块混在 200 响应里、用例的薄封装不抛 ⇒ 错误被吞，
拖到下一条 `project.list` 断言才红（读数是「list 里没这一行」，看不出真因）。
GA 每日档自 #4090 落地后连红（#4274：run 44203577610 等）。

- e2e 改送 `projectId`（与路由 schema、其余端点一致）。
- 已在本地真跑 `e2e/main-journey.spec.ts` 验证。
