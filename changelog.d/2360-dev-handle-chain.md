## Changed

- `COMFYAPP_DEV_HANDLE` 没配时不再让「这份检出是谁」留空：取值收成一条链
  （`scripts/dev-handle.mjs`，唯一实现）—— `COMFYAPP_DEV_HANDLE`（进程环境 → 本检出 `.env`）
  → `CNB_NPC_NAME` / `CNB_TOKEN_USER_NAME` → `git config user.name` → 兜底 `cnb`。
  `pnpm env:init` 从此把取到的**具体名字**写进 `.env` 而不是补一个空值，
  `pnpm ship` 阶段 0 与 `--whoami` 会念出这个名字是「填的」还是「取的」。
- 每日 / PR 失败自动立案改用机器自己的名字（`ci-daily` / `ci-pr`，宿主有 NPC 名时带上），
  不再把平台账号昵称写成「这张单是机器提的」。
