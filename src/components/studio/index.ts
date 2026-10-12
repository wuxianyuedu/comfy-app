export { CanvasArea } from "./canvas/CanvasArea";
export type { CanvasAreaProps, ContextMenuItem } from "./canvas/CanvasArea";

export { VideoQueueModal } from "./VideoQueueModal";
export type { VideoQueueModalProps } from "./VideoQueueModal";

export { HomePage } from "./HomePage";
export type { HomePageProps, RecentProject } from "./HomePage";

/* ── 壳层（规范 §12.1 的目录树 / §12.2 的 barrel 示例里一直写着这两个名字，
 *    本轮才真正落地）── */
export { AppShell } from "./AppShell";
export type { AppShellProps } from "./AppShell";
export { TopBar } from "./TopBar";
export type { TopBarProps } from "./TopBar";
export { CommandPalette } from "./CommandPalette";
export type { CommandPaletteProps } from "./CommandPalette";
/* 视图枚举的权威来源是 `NavItems`（`WorkspaceNav` 退役后不再有第二个入口）。 */
export type { WorkspaceView } from "./NavItems";

export { WorksGallery } from "./WorksGallery";
export { ProjectOutputs } from "./ProjectOutputs";

/* 资源库：素材管理从工坊右栏的计数卡提成项目页签（与本文件同层的一级视图）。 */
export { ResourceLibrary } from "./library/ResourceLibrary";

export { ModelLibrary } from "./ModelLibrary";

export { WorkflowLibrary } from "./workflow-library/WorkflowLibrary";

/* ── 三个带重依赖的一级视图：**刻意不从本 barrel 转出** ───────────────────
 * `WorkflowCanvasEditor` / `FilmStudio` / `ProjectCanvas` 都吃 `@xyflow/react`
 * （画布引擎 + 它那份样式）。它们一旦在这里转出，任何**静态** import 本 barrel
 * 的模块都会把画布引擎拖进自己的静态图 —— 而入口 `src/app/workspace/page.tsx`
 * 正是静态 import 本 barrel 取 `HomePage` / `AppShell` 那几件的。
 *
 * 实测（`node scripts/check-barrel-heavy-deps.cjs`）：转出这三个时入口的静态可达
 * 图里会有 38 个模块直接或间接依赖 `@xyflow/react`；改走深路径 + `dynamic()` 后
 * 只剩 1 个（`~/lib/project-canvas/canvas-store`，它只借一个 `Edge` 类型）。
 *
 * 所以消费方一律写**深路径**：
 *   const ProjectCanvas = dynamic(() => import("~/components/studio/ProjectCanvas")…)
 * 这条由 `scripts/check-barrel-heavy-deps.cjs`（规范 §12.19）守着 —— 在入口补一层
 * `dynamic()` 不算修好，静态边还在（正是本案立案时的现场）。 */

/* 项目主页（进入项目后的落点）：状态总览 + AI 自主成片操纵台。
 * 走自己的 barrel（`project-home/index.ts`）—— 它与 `ProjectCanvas` 一样是
 * 一级视图，视图内部还有状态卡子件，收在目录里比平铺在 studio/ 好找。 */
export { ProjectHomePage } from "./project-home";
export type { ProjectHomePageProps } from "./project-home";

export { HistoryList } from "./history/HistoryList";

export { ToastProvider, useToast } from "./ToastProvider";
export type { ToastItem } from "./ToastProvider";

export { AuroraBackground } from "~/components/ui/aurora-background";

export { BrowserStatusBar } from "./BrowserStatusBar";

export { LogProvider, useLogPanel } from "./logs/LogProvider";
export { LogPanel } from "./logs/LogPanel";
