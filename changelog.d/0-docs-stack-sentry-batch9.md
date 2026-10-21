## Fixed

- **10 §10.8 那句「已接入 Sentry」教读者去调一条没有接线的路**。复量三件事：
  `src/sentry.server.config.ts` / `src/sentry.edge.config.ts` 在场，由
  `src/instrumentation.ts` 的 `register()` 按 `NEXT_RUNTIME` 两支挂上；
  **`src/sentry.client.config.ts` 不在树上**（缺的是一个 Sentry 项目与它的 DSN，
  登记在 `docs/guides/PRODUCTION-GAPS.md` 的 P0-3）；而 `Sentry.captureException`
  在全 `src/` **0 命中**。所以视图层今天写这条调用不会报错、也不会上报 ——
  浏览器侧 SDK 从未 `init`，属于「静默丢弃」那一类（比缺失更坏：读代码的人会以为这条
  错误已经有人收了）。改写为三层现状表 + 三条动作口径，并点名组件树崩溃的**唯一出口**是
  `ui/error-boundary.tsx` 的 `componentDidCatch`（`console.error` 进面板 + `onError` prop），
  将来接客户端上报挂这一处，不散在各组件各调一次 SDK。未配 DSN 时两支全 no-op 是刻意的。
- **15 §15.1 技术栈表按 `package.json` 复算，两个单元格当场错、一处把「latest」当版本**：
  `数据层` 那格写「12+」，而 `drizzle-orm` 钉的是 0.45.x、`better-sqlite3` 是 13
  —— **同一格对两个包都错**；`认证` 写「1.3+」，实装 1.7.x；`@sentry/nextjs` 写「10+」，
  钉在 11；`包管理` 写「latest」，而它是 `packageManager` 里钉死的一条。
  版本列整体换成「装的是哪一条 = 取 `package.json`」+ 一条复算命令，只留两条
  `package.json` 读不出来的事实：TypeScript 那条走 **npm 别名**、而 `pnpm exec tsc --version`
  报的数比别名大一位（按别名去「修」文档里正确的「TypeScript 7」就写错了），
  以及 `@tanstack/react-virtual` 与**日志面板那个例外**（它用本仓 `log-virtual.ts`，
  理由在 07 §7.28.2 —— 旧表那格「大列表/日志必用」把例外抹平了）。
  表里那行「`captureException` 上报」的关键约定同步改指 10 §10.8。
- **16 章那条「import 来自 `@base-ui/react`（非 `@radix-ui/*`）」两头都不成立**：
  `ui/form-rhf.tsx` 的全部 import 只有 `react`、`react-hook-form`、`cn`、`~/components/ui/label`
  （原生 `<label>` 薄封装，`ui/field.tsx` 也不经 base-ui）。想表达的「没把 radix 那套拉回来」
  这一半是对的，改成照这句话能查到的写法。同一处「当前状态（2026-09-02，已补齐）」那三个
  版本号按**当时读数**保留原数，但补一句：`react-hook-form` 现钉更高 patch，且「已补齐 /
  开箱即用」说的是这份绑定层可用 —— 它自己的模块头登记着「src 内 **0 消费点**、为将来预留」，
  与 §16.2.4.8「不接入 RHF」那条决策是同一件事的两个说法。
- **03 章 `AuroraBackground.tsx` 是个不存在的文件名**：组件在 `src/components/ui/aurora-background.tsx`
  （kebab 文件名 + 导出的组件名同名，文档抄了大写形态）。
- **这一族仍然没有任何判据会红**：`check-doc-references.cjs` 的 C1/C2 只覆盖 AGENTS.md 的
  路径与 `§NN.M` 锚点，`docs/**` 正文里的符号、版本号、类名 token 一个都不解析；
  15 章那张表也没有任何用例把它当输入（`grep -rn "15\.1" tests/*.ts` 空返回）。
  ⇒ 只能靠探针批量复量：本批用一份临时探针（反引号标识符 + 路径形态逐个对全树取字面命中）
  扫 03/05/06/08/09/10/14/15/16/18 十章，**零命中 ≠ 缺陷**：`Radio.Root` 是 base-ui 的公开名
  （仓内以 `Radio as RadioPrimitive` 的别名 import）、`popstate` / `window.confirm` 是浏览器 API、
  `model.sync` / `workflow.list` 是 tRPC 路由路径、`@formkit/auto-animate` 在 `package.json` 里 ——
  这几条都判为不动；`ModalDialog` / `formatSize` / `SETTINGS_SECTION_GROUPS` / `computePos` 等
  十余条 0 命中的名字留在下一批单独处理（要逐个读所在句子才能定性）。
- 复算：`pnpm doc:check` 退 0、`pnpm doc:render` 后四份生成物与源同批（其余 27 份零漂移）、
  四章 markdown 表格逐行按列数复量 —— 16 章那 12 处不等长**在主干上同样存在且条数相同**
  （是单元格内含竖线的既有形态，本批没引入新的），10 / 15 / 03 三章零 mismatch；
  新写的那条复算命令用 `node -e` 实跑过一遍（输出 30+ 条 `包名 版本`）。
