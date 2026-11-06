## Changed

**GA `pr-gate.yml` 三个装依赖的 job 检出面从全历史缩到 2 笔**（GA 侧适配清单 G-8）

`typecheck-db-format` / `fixed-structural-tests` / `affected-tests` 的判据基线都是 payload 的
`CNB_PULL_REQUEST_TARGET_SHA`，而镜像推来的合成 merge 的两个父正是 base 与 head ⇒
`git fetch --depth=2` 已含判据要用的全部提交。

- `fetch-depth: 0` → `fetch-depth: 2`（三格）
- `static-gates` / `heavy-gates` 保持 `0`：分支守卫 / 提交声明核对 / 补丁覆盖率 / 依赖新鲜度
  都读 `origin/master`，浅克隆里没有这条 ref
- LFS 不动：只有 `fixed-structural-tests` / `affected-tests` 会跑字体用例，其余三格本就不开

CNB 侧完全不动（任务 3 并行期纪律，§13.5.34）。
