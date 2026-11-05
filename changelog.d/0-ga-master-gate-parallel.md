## Added

ci: 新增 GA push 档 `.github/workflows/master-gate.yml`（任务 3 并行期，只加这一侧）。

镜像仓 master 的 `push` 上跑文档链两格，与 CNB push 档**并行**判、逐格比对结论：

- 触发：`on: push: branches: [master]`；并发 `push-master` + `cancel-in-progress: false`
  （对位 push 锁语义：每一笔都要有自己的读数，后一笔不掐前一笔）。
- 命令与 CNB push 档**逐字一致**（同一入口、同一旗标）：
  `node scripts/render-doc-placeholders.cjs --check --autofix`、
  `node scripts/check-doc-references.cjs`。
- 检出面：`fetch-depth: 0` + `lfs: true`；保留 `pnpm install --frozen-lockfile`。
  不复刻 CNB 的 `ifModify: docs/**`：两条命令都是秒级文本读，按路径过滤会在「代码改动
  破坏文档引用」时漏判。
- 失败可见性：**不回传 CNB、不改 ship 判据**；红只出现在镜像仓 Actions + GitHub 通知，
  现场日志用 `pnpm ship --gh-logs <run-id|pr号>`。

**本次不动 CNB 侧一个字节**：`master 合并复核` 的三格（`合并形态复核` / `GitHub master 镜像` /
`工作区出处`）与文档链两格全部保留；`COMFYAPP_CI_PUSH_GATES`、`GATE_TIER_LEDGER` 同样不动。
切换（从 CNB push 摘两格、缩清单、改台账）留给下一笔 PR，须先跑若干轮比对两侧结论一致。

判据钉在 `tests/doc-check-hook-wiring.test.ts`（触发/并发、两条命令逐字在场、检出与安装、
反钉「没有 `paths:`」）。**未验证**：镜像仓对 `--force` 推 master 是否必定触发 `push` 事件
目前是推断，未经真机实测；第一跑要在镜像推送成功之后才会出现。
