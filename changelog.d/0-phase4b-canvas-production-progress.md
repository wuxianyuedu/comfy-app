## Added

- **画布侧展示统一生产进度（Phase 4b / 设计 §7「两侧一致展示」）**：画布打开项目时，除物化镜头节点外，顺带从**同一份** `production` 行的 `progress` 列读回完成状态（`ProductionProgress`），以复用的 `ui/progress-bar`（`ProgressBar`）渲染一个左上角进度指示——数值由持久侧的「阶段游标 + rendered」派生（阶段序 / 总阶段数，`rendered` 记满格），工坊与画布读的是同一份单一来源。
  - 新增纯展示组件 `src/components/studio/project-canvas/CanvasProgressIndicator.tsx`（含 `stageProgressPct` 派生 + 单测）。只读持久侧枚举 `PRODUCTION_STAGES`，不引用工坊视图层的阶段标签，避免 studio→workshop 跨特性耦合。
  - `ProjectCanvas` 复用其挂载时**已有**的 `fetchProduction` 调用取 `progress`（不新增一次网络请求），仅在该项目确有生产数据时展示；覆盖层 `pointer-events-none`，不挡画布交互。

## 说明

复用既有 `ProgressBar` 出口而非自绘进度条（规范 16 §16.2.4.19）；层级用既有 `z-canvas-ui` token，未新增浮层层级刻度。为让 `CanvasInner` 保持在函数长度阈值内（§12.13），把右键菜单 + 落子的一簇回调抽到新子 hook `src/components/studio/project-canvas/hooks/use-canvas-menu.ts`（逐字搬家、行为不变）。§7 剩余的 `filmProject` / `workshopSession` 状态源收敛仍为后续独立项。
