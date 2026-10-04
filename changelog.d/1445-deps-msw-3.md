## Changed

- **`msw` 2.15.0 → 3.0.2**（ISSUE #1445 第 2 件，**大版本**）。面最窄的一件：全仓
  只有一处桩基建（`tests/helpers/trpc-msw.ts`）与七个调用点。

## Fixed

- **`server.listen({ onUnhandledRequest })` → `onUnhandledFrame`**（msw@3 的官方改名）。
  两处判据都要点清楚，它们不是同一件事：
  - **类型面**：`pnpm exec tsc --noEmit` 在升版后立刻报 7 条 `TS2353`（旧键不在
    `SharedOptions` 里），所以这条改名是**编译器点名**的，不是靠人记得；
  - **行为面**：改名之后必须**真确认策略仍生效**，否则「桩漏了就红」这条防线会静默
    消失（旧键被当成未知属性忽略 —— 表现是全绿）。实测核过：`onUnhandledFrame: "error"`
    下未拦截的请求仍以 `[MSW] Error: intercepted a request without a matching request
    handler` 拒绝，有 handler 的请求照常放行。

  改动面：`tests/helpers/trpc-msw.ts`（用法注释里的示例一并改，它就是调用点的模板）、
  `src/app/(main)/settings/hooks/use-settings-page.test.ts`（3 处，含两处解释性注释）、
  `src/components/studio/ModelLibrary.integration.test.tsx`、
  `src/components/studio/hooks/use-model-folder-config.test.ts`、
  `src/components/studio/hooks/use-model-library.test.ts`、
  `src/components/studio/workflow-library/hooks/use-workflow-library.test.ts`、
  `src/components/workshop/hooks/use-llm-config.test.ts`、
  `tests/integration/renderWithProviders.integration.test.tsx`。

- **`setupServer` 不再从 `msw` 根导出**（msw@3 的包结构变化）：`msw` 根入口现在只留
  `lib/core` 的内容，Node 侧要写 `import { setupServer } from "msw/node"`。本仓
  `tests/helpers/trpc-msw.ts` 原先就是打 `msw/node`，**没有**受影响 —— 记在这里是因为
  它是一条容易被反推错的边界：`http` / `HttpResponse` 仍从根导入，两个入口的分工不能在
  调用点各猜一次。
- 核过 `pnpm-workspace.yaml` 的 `allowBuilds` 里 `msw: true` 仍然需要（msw@3 依旧带
  postinstall），名单未变；`.storybook/data-sources.tsx` 那套注入层**不依赖 msw**
  （它的文件头就写明了「为什么不是 msw / `vi.mock`」），本件不涉及。
