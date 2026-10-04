## Changed

- **`@sentry/nextjs` 10.75.0 → 11.4.0**（ISSUE #1445 第 3 件，**大版本**，构建期）。
  `tsc --noEmit` 与 `pnpm run lint` 在升版后均零错误，源码侧**零改动** ——
  本仓对 Sentry 的用法只有三处（`Sentry.init` + `beforeSend` 脱敏、
  `src/instrumentation.ts` 里按 runtime 的两条动态 import），没有碰到 11 的破坏面。

- **按硬规则 4 的邻域核过产物**（这是本件唯一有实质风险的地方，逐条实测）：
  - `pnpm build` 全链路通过（`next build` → `build-executor-host` → 剥私有输入 →
    数产物 → 宿主冒烟），`node scripts/check-standalone-contents.cjs` 退 0
    （2511 个文件，无测试 / 文档 / 变更碎片 / 开发机私有输入 / 开发期文件与门禁脚本）。
  - **硬规则 18 那条陷阱确认没被踩**：11 把 Next 自带的
    `next/dist/compiled/next-server/*runtime.prod.js` 也纳入了 standalone tracing，
    于是 `.next/standalone/node_modules/.pnpm/` 下**同时**留着 10 与 11 两份的拷贝。
    逐个数过：两份各 14 个 `*.runtime.prod.js`（含 `app-route-turbo` 那一条 ——
    缺它表现为「页面正常、每个 API 路由 500」），清单逐字相同，`next.config.js` 的
    `outputFileTracingIncludes` 与 `tests/standalone-runtime-completeness.test.ts` 都不用动。
  - 旧 10.75.0 那份拷贝没被 11 的剥离逻辑清掉，但它只含 26 个 `next/dist/compiled/`
    的运行时脚本、**没有 Sentry 自身的代码**（`@sentry/nextjs` 的 `build/` 不在里面），
    对「每个 API 路由 500」那条判据无影响；产物层的顶层白名单与计数口径也照旧放行。
    这件事**不是这次升级引入的、也不由这次升级解决**（要干净去重得让 pnpm 的
    虚拟 store 名不再把 peer 组合编进目录名），故本次只如实记档、不顺手改判据。

- 顺带核过：`pnpm-workspace.yaml` 的 `allowBuilds` 里 `"@sentry/cli": true` 仍然需要
  （11 依旧经 `@sentry/bundler-plugins` 把它带进来）；`.storybook/` 与 `e2e/` 不涉及。
