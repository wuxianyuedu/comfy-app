## Fixed

- **入口的静态图上不再有重依赖：`@xyflow/react` / `shiki` / `react18-json-view` /
  `marked` / `dompurify` 全部退出 `src/app/workspace/page.tsx` 的静态可达图**
  （ISSUE #1777）。修前实测该入口静态可达 **692** 个模块、其中 **44 处**直接或间接
  依赖画布引擎（`shiki` / `json-view` / `marked` / `dompurify` 也都在列）；
  修后 **343** 个模块、**0 处**。

  **根因是一条「两件都正常、合起来很贵」的组合**：入口**静态** import 了
  `src/components/studio/index.ts` 这个 barrel（只为取 `HomePage` / `AppShell`
  等四件便宜东西），而 barrel 里同时转出 `./ProjectCanvas`（画布引擎）与
  `./FilmStudio`。入口对这两个模块另外写了 `dynamic(() => import(…))` ——
  **那一层懒加载是有效的，但拦不住「入口 → barrel → ProjectCanvas」这条静态边**，
  而这条边让整棵画布子树（38 个模块）进了入口的静态图。

  - **新判据** `scripts/check-barrel-heavy-deps.cjs`（规范 §12.19 / 02 §2.9）：
    从入口沿**静态**边做可达闭包，命中重依赖即红并打印**整条链**；登记清单
    `scripts/.barrel-heavy-deps.json`。跑在 pre-commit 的 D 组，另进
    `scripts/affected-tests.mjs` 的固定清单（改 `components/studio/` 不会把它带进
    受影响集，而这正是它要守的回潮形态）。回归用例
    `tests/check-barrel-heavy-deps.test.ts`（9 条，逐格配正例 + 负例）。
    判据的三条解析口径各对应一次实测：**只认静态边**（`import()` / `React.lazy`
    不算，早期 `[^;]*?from` 会把 `React.lazy` 里那句吃成静态边）、
    **`import type` 不算边**（编译后擦除，而立案现场有一半恰恰是类型）、
    **重依赖按「真引用」判**而非「文件里出现过这个字符串」。
  - **修法一（入口侧）**：`ProjectCanvas` / `FilmStudio` / `WorkflowCanvasEditor`
    从 `src/components/studio/index.ts` 撤出转出，入口改走深路径 + `dynamic()`；
    撤出的理由写在 barrel 里（消费方从 1 个涨到 2 个以上再考虑转出）。
  - **修法二（消费点按需化，三个可复用出口）**：`~/lib/markdown` 新增
    `loadMarkdownRenderer()` + 新 hook `~/components/workshop/hooks/use-markdown-html`
    （`marked` + `dompurify` 只在该屏真显示剧本时才下载）；
    新增 `~/components/ui/lazy-json-viewer` 的 `LazyJsonViewer`
    （`react18-json-view` 只在用户**展开**一行日志或打开弹窗时下载，
    替换 `logs/LogRow` 与 `Studio/SourceModal` 两处静态引用）；
    新增 `~/lib/project-canvas/canvas-persistence-types` 的
    `PersistedNode` / `PersistedEdge` —— 持久化层只做 JSON 存取，不该为借
    `Node` / `Edge` 两个类型把画布引擎钉在静态图上。
  - **仓内连带的两处类型收口**（都是同一类「形状说了不该由它说的事」）：
    `canvas-types.ts` 的 `CanvasNodeType` 两支 `data` 统一为 `CanvasNodeData`
    （`workflowArdot` 的「无业务数据」语义改由 `isCanvasNode` 与 `type` 承载，
    否则它与 `canvasNode` 不构成可赋值类型，任何按 `CanvasNodeType[]` 存的容器都
    接不住它 —— 持久化层就撞在这上面）；`PersistedNode.type` 取联合字面量而非
    `string`。`tsc --noEmit` 随之清零了三处已无意义的 `as CanvasNodeData` 断言。
- 规范同批更新：[12 §12.19](../docs/standards/12-代码组织与文件结构.md)、
  [02 §2.9.1](../docs/standards/02-性能规范.md)、
  [13 §13.1 自查清单](../docs/standards/13-提交与-code-review.md)。

## Added

- `scripts/check-barrel-heavy-deps.cjs` + `scripts/.barrel-heavy-deps.json` +
  `tests/check-barrel-heavy-deps.test.ts`：入口静态图的重依赖判据（见上）。
- `src/components/workshop/hooks/use-markdown-html.ts`、
  `src/components/ui/lazy-json-viewer.tsx`、
  `src/lib/project-canvas/canvas-persistence-types.ts`：三个按需加载 / 形状收口出口。
