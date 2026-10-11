## Changed

- tRPC 的 React 集成从 classic（`@trpc/react-query` 的 `createTRPCReact`）换到官方推荐的
  `@trpc/tanstack-react-query`：hub 改为 `createTRPCContext<AppRouter>()` 导出的
  `TRPCProvider` / `useTRPC`，并加一个 `createTrpcClient()` 给测试与工作台建同类型客户端
  （避免七处各自 import `AppRouter` 重抄一遍类型参数）。
- 调用形状随之整体替换（19 个 hooks 文件、59 处）：
  `api.x.y.useQuery(i, o)` → `useQuery(trpc.x.y.queryOptions(i, o))`、
  `api.x.y.useMutation()` → `useMutation(trpc.x.y.mutationOptions())`、
  `utils.x.y.invalidate(i)` → `queryClient.invalidateQueries(trpc.x.y.queryFilter(i))`、
  `utils.x.y.fetch(i)` → `queryClient.fetchQuery(trpc.x.y.queryOptions(i))`、
  `getQueryKey(api.x.y)` → `trpc.x.y.queryKey(...)`。各 hook 的对外签名与返回形状未变。
- **判据同批改**：`scripts/check-ui-logic-separation.cjs` 的 S3 原来只认
  `api.x.y.useQuery/useMutation` 字样——调用形状一换它就会**静默失明**，故并列认新集成
  的 `queryOptions(` / `mutationOptions(` / `infiniteQueryOptions(` / `queryFilter(`；
  自证覆盖两种形状与「相似名不误计」。同步改 `AGENTS.md` 硬规则 10、主规范、
  `standards/01` §1.7、`standards/17` 的 S3 行与那处叙述。
- 测试侧：`tests/helpers/renderWithProviders.tsx`、`.storybook/data-sources.tsx`、
  5 份 hook 单测与 1 份集成测试改挂新 provider；`tests/integration/` 那份不再自建
  classic 局部实例。classic 目前在仓库里**零消费者**（`@trpc/react-query` 是否摘除另行决定）。
- 两处 `vi.mock("~/trpc/react")` 夹具跟着换形（`use-queue-monitor.test.ts`、
  `use-workflow-save.test.ts`）：它们替的是「底层取数/变更」而不是 TanStack 本身，
  所以 `useTRPC` 只交一个 options 工厂、数据态由 `importOriginal` 局部替掉的
  `useQuery` / `useMutation` 给 —— 题目不变，17 条断言原样跑绿。

## Fixed

- 文档里的 typedoc 重生成入口写错了命令：`AGENTS.md`、`docs/README.md`、`standards/13`
  §13.5.5.1、`standards/15` 与主规范共 6 处都写 `pnpm docs`，而那是 **pnpm 的内建命令**
  （`pnpm docs <PACKAGE>` 打开某包文档），会抢在同名脚本前面 —— 照做的人拿到的是
  `error: the following required arguments were not provided: <PACKAGE>`，typedoc 一行没跑
  （本轮实际撞到）。统一改成 `pnpm run docs` 并写明原因。
