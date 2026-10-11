## Changed

- **Node 下限第一次有了声明与执行者**（规范新增 §2.1.8）。此前只有 `.nvmrc`（只对 nvm 用户生效）
  与 README 那句「Node.js ≥ 22」—— 而后者比 `jsdom` 自己声明的 `^22.22.2` 还松，恰好把
  22.0–22.22.1 放进「看起来合格」。叠起来的表现是最难归因的那一种：`next` 的下限只有
  `>=20.9.0`，所以低版本 Node 上 `pnpm dev` / `next build` **照常全绿，只有测试档炸**，
  而报错是 `Cannot find module` / `Failed to start forks worker` 一类，读起来像依赖坏了。
  - `package.json` 新增 `engines.node = "^22.22.2 || ^24.15.0 || >=26.0.0"` —— 这是把装机后
    每个依赖自己声明的 `engines.node` 求交算出来的（`vitest` `^22.12.0||^24.0.0||>=26`、
    `jsdom` 同上但更紧、`msw` `>=22.12.0`、`eslint` `^20.19.0||^22.13.0||>=24`、
    `@sentry/nextjs` 带上界），不是抄来的数；**数字不手抄 ⇒ 以后谁升依赖把下限抬上去而声明没跟，
    这一格直接红**。
  - 新判据 `scripts/node-engines.mjs`（范围解析 + 满足判定 + 「本仓声明 ⊆ 每条依赖声明」）；
    `pnpm check:toolchain` 打印结论，越界时点名「坏的是测试档」并给**最近可达档**建议，
    退出码仍 0（与 pnpm 版本不一致只 WARN 同一立场：这里回答能不能跑，拦截归启动器与钩子）。
  - 执行者是 `tests/dev-launcher-toolchain-gate.test.ts` 新增 9 格：扫描面非空且必须点名
    `vitest`/`jsdom`/`msw`（否则「零命中」长得像「谁都不挑 Node」）、README 那行与 `engines.node`
    同源，外加三格反向证明 —— 放宽成 `>=20.9.0` 必须点名被越过的依赖；**写成无上界的
    `>=24.15.0` 同样判红**（它放进 25.x，而 vitest/jsdom/eslint 是 `^24` 档，这条同时钉住
    「判据方向别记反」）；读不懂的形状（`20.x`）判「没跑起来」而不是判绿。
- **MSW 3 的官方入口对齐**（3 处）：`http` / `HttpResponse` 从 `msw` 根入口改到 `msw/http`
  （`tests/helpers/trpc-msw.ts`、`src/app/(main)/settings/hooks/use-settings-page.test.ts`、
  `src/components/studio/hooks/use-model-library.test.ts`）。官方 v3 迁移页明写这些导出
  「从指定入口取，而不是根入口」；实测装机的 3.0.2 根入口**仍在再导出**它们，所以这是
  口径对齐、不是修故障 —— 同批把 `msw/node` 那侧保持原样（它本来就在指定入口上）。
- README「环境要求」那行同时订正 pnpm 版本：写的是「pnpm 10」，而 `packageManager` 是 `pnpm@12.4.1`。

验证：`tsc --noEmit` 零错、eslint 零警告、新增 9 格全绿、`pnpm check:toolchain` 真跑两种档
（当前 Node 打 OK / 注入 `v20.9.0` 打 WARN 且退 0）、`doc:render` 重渲染生成态文档。

遵循：§2.1.8（本次新增）/ §12.14 与 §13.5.13（会烂的数字改成现算）/ §13.10.5 碎片 / §13.5.5 生成物同步
