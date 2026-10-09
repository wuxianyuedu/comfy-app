## Fixed

「本容器无 `node_modules`，所以走不到 `tsc` / `eslint` / `vitest`」这个结论**不成立**，
而它此前被当成结论用过一次 —— 25 条类型错因此绕过所有门禁落进 `master`（复算见
`0-tsc-annotations-after-squash-merge.md`）。本仓库依赖**全部来自公开 registry**
（`pnpm-workspace.yaml` 无私有源），任何检出 / 容器 / NPC 工作区都能装上：冷装实测
`pnpm install --frozen-lockfile` 约 8 分钟，装完 `tsc --noEmit` / `eslint` / `vitest`
三条门禁全部可跑且为绿。**「还没装」与「装不了」是两件事。**

改了三处（一个判据、一条规则、一份措辞）：

- `scripts/check-pnpm-available.mjs`（`pnpm check:toolchain`）：依赖未装那一分支不再
  只打一句 WARN + `pnpm install`（读起来像「环境不支持」），而是正面回答那个被误判的
  问题 —— 能不能装 / 装多久 / 装完能跑什么，并显式点名「不得以本容器无 `node_modules`
  为由跳过门禁」（指向规范 §13.6.3）。依赖已装那一支也补上「`tsc` / `eslint` / `vitest`
  都能跑」，否则读者只看到一句与门禁无关的「已装」。
- 同文件的 `node_modules` 判据**改为 import 启动器的 `checkNodeModules()`**
  （`scripts/launcher-core/worktree.mjs`）：本文件此前留着一份只查 `.modules.yaml`
  的弱化副本，与启动器的「`.modules.yaml` + `.bin/next` + 关键依赖目录」两份口径
  并存 —— 自检说「已装」而启动器说「残缺」（或反过来）是必然的，也正是本条要修掉的
  「同一个判断、两个实现、各自漂移」的形状（§12.18 / §12.12）。
- `AGENTS.md` 硬规则 26 + 「快速排障」一条：禁止以「环境里跑不到门禁」为由跳过校验、
  也禁止把这个理由写进提交信息或 PR 描述充当「已校验」；前置判断只用
  `pnpm check:toolchain`。规范侧新增 [§13.6.3](docs/standards/13-提交与-code-review.md)
  与 §13.1 自查清单的一条，`docs/generated/` 同步重生成。

契约测试：`tests/dev-launcher-toolchain-gate.test.ts` 加 3 条（依赖已装的说法 /
依赖未装分支的措辞 / 不许再留弱化副本），走脚本新增的 `--deps-root` 接缝 ——
它只换依赖检查的根、不换工具链探测的根（后者要读本检出的 `package.json` 拿
`packageManager`，跟着换会让自检报一个与本检出无关的 pnpm 版本）。

节点校验：`pnpm exec tsc --noEmit` → 0 行；`pnpm exec eslint <改动文件>` → 零警告；
`pnpm exec vitest run --no-file-parallelism tests/dev-launcher-toolchain-gate.test.ts`
→ 49 条全绿；`pnpm doc:check` / `check-gate-executors` / `check-declaration-readers` 全绿。
