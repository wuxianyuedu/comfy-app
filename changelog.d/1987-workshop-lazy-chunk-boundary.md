## Fixed

- **工坊六段的懒加载撞上「分块已被换掉」时不再整屏崩**（ISSUE #1987）：现场是点开工坊
  剧本段时控制台一条 `ChunkLoadError: Failed to load chunk /_next/static/chunks/src_1w9lw22._.js
from module [project]/src/components/workshop/ScriptGenerator.tsx [app-client] (ecmascript, async loader)`，
  整屏被路由级边界替换成「页面出错了」。成因在 dev server 一侧（这些段是 `React.lazy` 懒加载的，
  页面首帧只拿到分块哈希，dev server 重建后哈希指向被换掉的旧文件，`import()` 只能 reject），
  而**出口缺失**是本仓的：分块失败的自愈只有 `~/lib/shell/lazy-chunk-recovery` 一处实现，
  但它此前只接在 `WorkspaceViewStack` 的 `next/dynamic` 出口上 —— 工坊的 `React.lazy` 那一路
  一个都没接，于是错误只能一路冒到工坊外面。
  修法两层：① 新增 `~/components/ui/use-lazy-chunk-fallback`（判据复用
  `isChunkLoadFailure`，不另写一套）+ `ErrorBoundary` 局部隔离（规范 10 §10.1 的 L2），
  每一段各自一条边界，降级 UI 说清「哪一块没加载上」并给**真能出去**的动作
  「重新加载页面」（重试没用：`reset()` 重渲染的是同一棵树、手里的哈希还是旧的那份）；
  ② 工作流库的画布预览（`next/dynamic` 出口之外的另一条 `React.lazy`）同批接上。
  `ErrorBoundary` 的 `fallback` 契约顺带补一档：函数形态返回 `null` 表示**不接管**，
  退回它自己的默认降级 UI —— 此前有值时返回 `null` 会渲染成整块空白。
- 新增判据 `workshop-stage-chunk-recovery.test.ts`：钉住「裸 `React.Suspense` 只剩外壳里那一处」
  与「每个懒加载组件都被 `StageBoundary` 包着」—— 漏一段在正常构建下完全看不出来，
  只在 dev 重建后偶发崩那一屏。
- 同批补 `use-lazy-chunk-fallback` 的 story（`ui/` 组件覆盖率台账 98 → 99），
  `docs/guide-storybook.md` 里写死的 88/88 顺手改对。
