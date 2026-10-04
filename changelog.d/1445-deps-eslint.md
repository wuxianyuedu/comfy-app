## Changed

- **`eslint` 10.11.0 → 10.12.0**（ISSUE #1445 第 1 件，小版本、无 breaking）。
  改动面只有 `package.json` 的声明下限与 `pnpm-lock.yaml`；`pnpm run lint`（零警告）
  在升版后逐字重跑通过，`pnpm-workspace.yaml` 的 `minimumReleaseAge: 0` /
  `allowBuilds` 名单 / `verifyDepsBeforeRun: false` 与 `next.config.js` 的
  `experimental.useTypeScriptCli: false` 均未被这次升级动摇（硬规则 2）。
  连带核过：`@typescript-eslint/eslint-plugin` 那条版本锁（8.71.0）仍与
  `typescript-eslint` 同版本，否则 ESLint 10 会在扁平配置合并时报
  `Cannot redefine plugin "@typescript-eslint"`。
