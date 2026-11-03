## Changed

**eslint 与 oxlint 并行判定 + parity 对齐（#2777 第一步）**：

`lint` 命令名不变，实现改为 `lint:eslint && lint:oxlint`（两侧零警告语义都保留），
所有继承 `lint` 的 CI / pre-commit / pre-push / `check:premerge` 自动跟随；
依赖与 CI 的 eslint 环节本批**一行未动**。

- 新增 `oxlint.parity.config.mjs`：按 eslint 的真实文件类（TS 源码 / `scripts` js 面 /
  根级 `*.config.{js,mjs,cjs}`）镜像生效规则，不 extend 预设、`categories` 全 off，
  全仓 0 命中（`--type-aware`）。
- 补开并清零 5 条：`no-empty-function`、`no-inferrable-types`、
  `non-nullable-type-assertion-style`、`unbound-method`、`import/no-anonymous-default-export`。
- 口径差异一律对齐到更严一侧：12 条 `@next/next/*`、`react-hooks/exhaustive-deps`、
  `@typescript-eslint/no-unused-vars` 在 eslint 侧升 `error`；`no-useless-assignment` 在
  oxlint 侧升 `error`；`no-img-element` 保持刻意 `off`；`boundaries/dependencies` 的
  options 逐条核对后确认两侧一致。
- 修 `eslint.config.js` 的层覆盖缺陷：router 档后置并携带 store selector 条目，
  「只许 `TRPCError`」与「store selector」两条 `no-restricted-syntax` 同时生效；
  `*.test.ts` 从 router 档排除（测试夹具模拟裸 Error 是被测行为本身）。
- `tests/router-error-envelope.test.ts` 由「断言配置源码文本」改为**行为断言**：
  导入真实配置取生效条目，用 `Linter` 实跑样例，并同时验证 router selector 与
  store selector 都还会响。
