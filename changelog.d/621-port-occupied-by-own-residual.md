## Fixed

- **启动时端口被判成「别的进程占用」而那条进程其实就是本检出自己的残留（ISSUE #621）**：`.env` 里把 `COMFYAPP_PORT` 写成固定值、或上一次启动的 dev server 没干净退出时，端口上听着的是本检出自己的服务，却一条回收路径都没跑 —— 会话锚点（`run/launcher-session.json`）在正常收尾时已清掉，而 `pidBelongsToRoot` 只判「命令行里有没有出现过检出根路径」，`pnpm dev -p N` 与 `next dev --turbo` 两条命令行里都没有它。现在端口归属补第 ② 层**应用服务自证**（`portOwnershipVerdict`，`launcher-core/orchestrator.mjs`）：命令行跑的是本仓库的 `scripts/dev.mjs` / `scripts/start.mjs` 或 `next dev` / `next start` CLI 即认定为本检出残留并回收整棵进程树；同时由 `usesExplicitPort()` 把这条自证收窄到**显式端口**——缺省解析链上「本检出的残留」与「另一份检出 / 用户手工起的实例」无法区分，一律退回旧结论（只提示，不猜着杀，§1.4）。
