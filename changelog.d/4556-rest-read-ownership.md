## Fixed

- REST 读路径补归属校验，堵住跨用户读取（IDOR）：`GET /api/tasks/[id]/stream`（SSE 执行流，含提示词/日志/产物清单）与 `GET /api/tasks/[id]/raw-cli`（comfy-cli 完整原始输出）此前只判「已登录」，任意登录主体可凭他人 taskId 读取；现在连接建立/返回前经 `taskRepository.findByIdForUser(user.id, id)` 判归属，不命中回 404（与 tRPC `task.detail`/`task.cancel` 的 NOT_FOUND 同口径）。单机演示模式（无会话回落同一演示用户）行为不变。（#4556）
