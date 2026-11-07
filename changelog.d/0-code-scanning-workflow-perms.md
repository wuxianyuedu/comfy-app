## Security

**CodeQL `actions/missing-workflow-permissions`（#3 / #4 / #5 / #6 / #7 / #20）**：

- `.github/workflows/pr-gate.yml` 的五个 job（#3–#7）与
  `.github/workflows/master-gate.yml` 的 `doc-chain`（#20）此前没有声明 `permissions`，
  `GITHUB_TOKEN` 会拿仓库默认权限。两者都只读仓库（checkout、装依赖、跑判据、上传
  artifact），因此在工作流顶层补 `permissions: contents: read`（最小权限）。
- 不需要 `actions: write`：artifact 上传与 pnpm / rust-cache 走 `ACTIONS_RUNTIME_TOKEN`，
  与 `GITHUB_TOKEN` 的权限无关。
