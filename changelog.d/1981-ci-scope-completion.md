## Changed

- 平台侧流水线再收窄两处，**判据一条没改**：
  - `API 文档生成物与源同步`（自托管节点上最贵的一格，实测 201.8s / 整条 12m14s 的
    27.5%）带上 `ifModify`，而它的 globs 由判据自己的 `INPUT_RES` **机械反推** ——
    「产物由哪些输入决定」只有一处出处，改判据的触发面时配置跟着变；
  - `Install dependencies` 的「装」那一跳按语义跳过：依赖面（锁文件 / `package.json` /
    `pnpm-workspace.yaml` / `next.config.js`）一项都没碰就不装。`pnpm` 自证照旧每次都跑
    （它是前提，跳不得）。
- `check-docs-api.cjs` 的输入面补上判据自身与它共用的跑法（`scripts/typedoc-run.mjs`）——
  此前改它们**不触发它们自己**。

升级方会看到的差别：一行 `src/lib|server|trpc` 都没碰的 PR 不再付那 200 秒；
只改文档 / `changelog.d/` / `src-tauri` 的 PR 不再付安装那一跳。
判据强度不变，「没跑」也不会被当成「跑过了」—— 新判据
`tests/ci-install-deps.test.ts` 与 `tests/ci-incremental-gates.test.ts` 后者那条样本式
双向核对守着。口径见规范 §13.5.20。
