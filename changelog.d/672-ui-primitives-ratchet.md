## Added

- **UI 基元复用棘轮（规范 16 §16.2.3）**：视图层自实现 UI 基元此前**没有任何机器判据**（`check-ui-logic-separation` 管的是 IO 分层，不管组件复用），于是 `src/components/ui/` 的 29 个基元只有少数被引用，同时视图里长出手写 `<button>` 408 处、自建 `createPortal` 浮层 10 处、自写 `animate-spin`/`animate-pulse` 40 处。新增 `scripts/check-ui-primitives.cjs`（`pnpm ui:primitives` / `--report` / `--update`），三条判据（P1 手写 button / P2 自建 portal / P3 自写 spinner）按文件记账、只许降不许升，基线 `scripts/.ui-primitives-baseline.json` 冻结在 458 处 / 115 文件；接入 pre-commit 第 12 步（提交门槛 24 → 25 步），契约测试 `tests/check-ui-primitives.test.ts`（14 条）。
