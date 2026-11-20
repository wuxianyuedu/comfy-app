## Fixed

- 工坊草稿的 REST 读/写/删补归属校验（IDOR 收尾，接续任务两条那笔）：`GET/PUT/DELETE /api/workshop/draft` 此前只判「已登录」，任意登录主体可凭他人项目 id 读取、删除他人的剧本/分镜/角色草稿，且 `upsertDraft` 的 `onConflictDoUpdate` 会把他人草稿的 `userId` 接管成调用方。现在 `getDraft`/`deleteDraft` 按「本人或无主（userId 为空的历史行）」过滤（不命中与不存在同形，不泄露存在性）；PUT 先经新增的 `findDraftOwner` 分清「不存在」与「属于别人」，他人草稿按 404（NOT_FOUND，与 tRPC 同口径）拒绝；upsert 加 where 守卫，归属不再被接管。单机演示模式与历史无主数据行为不变。（#4556）
