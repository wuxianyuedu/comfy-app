## Fixed

- **`pnpm doc:check` 的 AGENTS.md 路径守卫不再把运行期产物判成「文件不存在」**
  （`62283f41` 引入的恒红，随本轮顺手收掉）。判据把 `db.sqlite` 登记进了
  `AGENTS_ROOT_FILES`，而它被 `.gitignore` 忽略 —— 干净检出（CI / 新克隆 /
  评审容器）里永远不存在，只有跑过 `pnpm db:push` 的开发机才有，于是这条守卫
  一直红着。更坏的不是红，而是**红指向的动作是错的**：按提示去改 AGENTS.md 会
  删掉一句本来就该写的话（第 17 条硬规则讲的是「`next build` 会把它复制进
  产物」，不是「仓库里有这个文件」）。

  修法是让判据落在 `.gitignore` 上，而不是再列一份豁免名单：被忽略 = 不进版本库
  = 不能要求存在。名单会漏、会随 `.gitignore` 漂移，`.gitignore` 不会。反向保护
  照旧（真不存在的路径仍然点名行号拦下），回归见
  `tests/check-doc-references.test.ts` 新增的两条。

  > 本条不是本 PR 的变更引起的，单独成 commit：命中的是全仓库的 `pnpm doc:check`，
  > 与 `.cnb.yml` 删除是两件事（复算证据：`62283f41` 加的这一项，`git worktree`
  > 在干净 `8147f587` 上跑 `pnpm doc:check` 同样命中）。
