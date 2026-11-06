## Changed

**GA `pr-gate.yml` 两个装依赖的 job 检出面从全历史缩到 2 笔**（GA 侧适配清单 G-8）

`typecheck-db-format` / `affected-tests` 的判据基线都是 payload 的
`CNB_PULL_REQUEST_TARGET_SHA`，而镜像推来的合成 merge 的两个父正是 base 与 head ⇒
`git fetch --depth=2` 已含判据要用的全部提交。

- `fetch-depth: 0` → `fetch-depth: 2`（两格）
- `fixed-structural-tests` **保持 `0`**：这一格的固定清单里有
  `tests/audits-doc-references.test.ts`，它的「判据面非空」用例用
  `git log --all --diff-filter=D -- scripts/` 现算「曾入库、今天已不在」的棘轮基线名单；
  `depth=2` 的浅克隆里这趟 log 只看得见 2 笔提交，名单恒空，那条锚点会**天天红**
  （实测：B5 子批1 的 GA 跑 `cnb-4fn-1k6nq1vu3`，`fixed-structural-tests` 红在
  `expected 0 to be greater than 0`；同一检出在完整历史下 7/7 绿）。
- `static-gates` / `heavy-gates` 保持 `0`：分支守卫 / 提交声明核对 / 补丁覆盖率 / 依赖新鲜度
  都读 `origin/master`，浅克隆里没有这条 ref
- LFS 不动：只有 `fixed-structural-tests` / `affected-tests` 会跑字体用例，其余三格本就不开

CNB 侧完全不动（任务 3 并行期纪律，§13.5.34）。
