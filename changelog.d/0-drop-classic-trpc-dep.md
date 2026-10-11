## Removed

- **摘掉 tRPC 的 classic React 集成依赖 `@trpc/react-query`**（收口 #1736 留下的那一格：迁移那笔写明
  「classic 现在全仓零消费者，是否摘除留给单独一拍」）。
  - 迁移后源码 / 脚本 / 测试 / Storybook 对它**零引用**（`grep` 全仓只剩 `package.json` 一行与 lockfile 条目），
    而新集成 `@trpc/tanstack-react-query` 的 peer 要求是 `@trpc/client` / `@trpc/server` /
    `@tanstack/react-query` / react / typescript —— **不含** `@trpc/react-query`，所以摘它不会让谁在运行期扑空。
  - `pnpm remove @trpc/react-query`：`package.json` 少一行、`pnpm-lock.yaml` 少 20 行、安装面 -1 包。
    不需要动 `pnpm-workspace.yaml` 的 `allowBuilds`（那是**新增**带构建脚本的依赖才要同步的一格）。
  - **S3 判据继续认旧 classic 形状**（`api.x.y.useQuery/useMutation`）：那条拦的是「回潮」，
    与依赖装没装无关，所以 `AGENTS.md` 硬规则 10、`standards/17` 的 S3 行与
    `scripts/check-ui-logic-separation.cjs` 一律**不动**。
- 验证：`tsc --noEmit` 零错；eslint 零警告；jsdom 档与受影响用例（见 PR）绿；`pnpm check:deps-freshness` OK。
