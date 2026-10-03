## Security

- **依赖审计亮了一条「上游根本没有修复版」的 high：`braces`**（GHSA-vfj7-8cjw-p6xm，deeply nested patterns → 栈耗尽 DoS）。这是 registry 侧新出的 advisory（同一晚 `webpack-dev-middleware` 那条已被 #1396 用 override 消掉，这条是随后才命中的），命中即拦住从 master 分出的每一个 `check:all`。
- 判据给的出路 ①（升 / override 到修复版）在这一条上**不存在**：registry 的 `patched_versions` 为空，而受影响范围 `<=3.0.3` 正好覆盖当前解析到的 3.0.3。所以按规范 §13.5.9 走「确实修不了的逐条补 key + reason」，**没有**拿 `--update` 当后门（它本身就拒绝把新条目写进基线）。
- 写进台账的原因是实测三条，不是推测：① 本仓运行时代码没有一处 `import "shadcn"`（`src` / `scripts` / `tests` 全量 grep 零命中，`package.json` 也没有脚本引用它）—— 它是按需召唤的组件 CLI；② 出厂件不经它（`.next/standalone/node_modules` 实测只有 `@libsql` / `next` / `pino` / `react` / `react-dom` / `ws` 六个，shadcn 链上任何一环都不在）；③ 触发条件是「把攻击者控制的 glob 模式交给 micromatch 解析」，本仓没有这样的路径。
- 复评触发点也写进同一条 reason，防止它变成永久豁免：braces 一旦发布 `>3.0.3` 的修复版 → 升 / override 并**删掉本条**（留着会被这条判据的 stale 一侧判红 —— 双向拦是刻意的）；哪天有代码真的 import `shadcn`、或把外部输入喂给 glob 解析 → 暴露面那句判断作废，重评。
- 本轮**不做**的另一件事记在这里备查：把 `shadcn` 从 `dependencies` 挪到 `devDependencies`（安装面更干净），但它不消掉这条 advisory（审计看整份 lockfile），所以不混进这一笔。

## Tests

- `tests/dependency-audit.test.ts` 的 17 条契约用例照旧全绿（键的形状、严重级筛选、双向拦、空 reason 必拦），`node scripts/check-dependency-audit.mjs` 报「high/critical 命中 1 条，其中基线内 1 条」并通过。
