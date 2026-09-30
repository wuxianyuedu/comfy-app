## Added

- **状态栏「立即同步」按钮**：数据库结构过期（`stale`）或表没建起来（`missing`）时，底部状态栏不再只让人去终端跑 `pnpm db:push`——新增「点击同步」入口，点击后经危险确认弹窗（明示丢数据风险）由 `POST /api/schema/push` 以 `--force` 口径发起一次同步，进度与结果仍走既有的状态文件 → 2s 轮询链路。全自动执行被明确否决（那批变更含删列 / 重建表，启动链路不替用户做丢数据的决定），按钮只发起、授权在确认弹窗。桌包载荷没有 drizzle-kit，`GET /api/schema` 新增 `canPush` 能力位，无执行件时回落为纯命令提示。证据：`src/app/api/schema/push/route.ts`、`src/components/studio/hooks/use-schema-sync-push.ts`、`scripts/db-schema-state.mjs`（`ensureSchemaCurrent` 的 force 分支）。
