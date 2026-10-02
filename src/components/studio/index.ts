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

export { ModelLibrary } from "./ModelLibrary";

export { WorkflowLibrary } from "./workflow-library/WorkflowLibrary";

export { WorkflowCanvasEditor } from "./canvas/WorkflowCanvasEditor";

export { FilmStudio } from "./FilmStudio";
export { ProjectCanvas } from "./ProjectCanvas";

export { HistoryList } from "./history/HistoryList";

export { ToastProvider, useToast } from "./ToastProvider";
export type { ToastItem } from "./ToastProvider";

export { AuroraBackground } from "~/components/ui/aurora-background";

export { BrowserStatusBar } from "./BrowserStatusBar";

export { LogProvider, useLogPanel } from "./logs/LogProvider";
export { LogPanel } from "./logs/LogPanel";
