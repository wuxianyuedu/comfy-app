## Fixed

- **依赖审计：`handlebars` 两条 critical advisory 收到最小修复版**（`pnpm-workspace.yaml`
  的 `overrides` 加 `handlebars@4: 4.7.10`）。advisory `#1241677` / `#1241678` 的
  `patched_versions` 都是 `>=4.7.10`（受影响区间 `>=4.0.0 <=4.7.9`），两条引入路径都在
  `eslint-plugin-boundaries` 下。**这不是本次改动引入的**：引入提交是 `7f5d7542`
  （`eslint-plugin-boundaries` 落地），这两条是 advisory 库更新后才冒出来的存量，在
  「组件工作台」这条线上第一次被 `pnpm check:all` 点到。handlebars 在本仓只经 eslint
  工具链、不在运行期被 require。
- 取**最小可达修复版**而不是 range 写法（range 会让下一次 `pnpm install` 悄悄跳到没人
  复核过的新版本，同 `pnpm-workspace.yaml` 该块开头的口径）。
- 判据：`pnpm why handlebars` 只剩 `4.7.10` 一个版本；
  `node scripts/check-dependency-audit.mjs` 不再报这两条（基线外新增 0 条）。
