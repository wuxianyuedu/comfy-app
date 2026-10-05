## Added

- **组件工作台补上三层注入（store / React Flow / 整屏容器），业务目录的 story 铺到能摆「真形态」**（ISSUE #1381）。上一批把 `studio/` / `workshop/` 铺到 23 份时，明确划出三档刻意不碰的（写 store 的件、吃 React Flow 上下文的件、整屏容器）——理由是「挂假 provider / 塞占位子件得到的假形态比没有 story 更糟」。这一批把这三档的**前提**补上，三份注入层各自给「真的那一份」：
  - **store**（`.storybook/store-sources.tsx`）：story 用 `parameters.storeScene` 声明场景，场景收的是**真格式的日志原文**，由 store 自己的 `parseFileLogs()` 解析、经真 action `appendFileLogs()` 落板 —— 计数、来源分桶、时间线排序全由生产代码算出来。场景按**通道分块**（`OriginBlock[]`），因为三路日志的正则各不相同，一段原文冒充三条通道会让「来源」整列同名、分桶与计数等于没验。落在 `log-panel` / `log-panel-header` / `log-filter-bar` / `log-row` / `save-export-button` 上。
  - **React Flow**（`.storybook/flow-canvas.tsx`）：真 `<ReactFlowProvider>` + 真 `<ReactFlow>`（真转换矩阵、真视口、真 `useNodeId()`），节点渲染器由 story 经 `nodeTypes` 注入。落在端点（`useNodeId()` 拿得到宿主 id 的那一档与画布外的退化档并排）、毛玻璃层（缩放三档，看 Chromium 重铺平铺那条 bug 的修法）、网格与标尺（缩到细网格淡出阈值之下，底色必须还在）。
  - **整屏容器**（`.storybook/screen-frame.tsx`）：真 `AppShell` + **真视图**（`WorksGallery` 那种真读 `canvas-store` 的屏），项目经真 action `createProject()` 建（「名字撞不撞 / 有没有置活跃」都在这套规则里）。落在外壳、项目画布、工坊管线、项目页。
- 新增 story 12 份（全仓 108 → **120 份**）；`ui/` 覆盖率棘轮不受影响（分母只看 `ui/`）。

## Fixed

- **整屏容器里「项目在子树渲染之后才建好」会让 story 摆错形态**：`ProjectCanvas` / `WorkshopPipeline` 在**挂载那一刻**读 `getActiveId()`（工坊那处是 `useState` 的初始化器），而 React 的 effect 顺序是**子先父后** —— 把「建项目」放 `useEffect` 里，子组件读到的是「还没有活跃项目」，工坊标题落在「未命名项目」上、画布落在空白草稿上，而 story 里摆的明明是一个有名字的项目。修法 = 走 `useState` 的**惰性初始化器**（在子树渲染之前执行），删除仍留在 unmount 清理里。

## Tests

- `tests/storybook-injection-layers.test.ts`（7 条，进 `FIXED_STRUCTURAL_TESTS`）：守三层模块各自的接线与形状 —— 场景名不认识时抛错、块级 `origin`、真 `ReactFlowProvider`、真 `AppShell` + 真 action、「项目在子树渲染之前建好」这条初始化器口径、三处是否都挂在 `preview.tsx` 的装饰器链上。变异核过（把惰性初始化器改回 `useEffect` → 对应用例红）。
- 452 条 story 逐条在无头 Chromium 里打开核对：**452/452 渲染、0 白板**（含本批新增的 12 份）。

## Docs

- 规范 16 新增 **§16.2.3.10**（三层注入的形状、三条口径、两处踩坑、跨源门槛照旧）；`docs/guide-storybook.md` 新增「三层注入：store / React Flow / 整屏容器」一节（含三份可照抄的用法样板）。
