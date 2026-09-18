"use client";

import { useState, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import {
  VideoQueueModal,
  HomePage,
  WorkspaceNav,
  AuroraBackground,
} from "~/components/studio";
import type { RecentProject, WorkspaceView } from "~/components/studio";
import { WorkshopPipeline } from "~/components/workshop/WorkshopPipeline";
import { ShellTabs } from "~/components/studio/ShellTabs";
import {
  listProjects,
  setActive,
  reapAllEmptyDrafts,
} from "~/lib/project-canvas/canvas-store";

/* ── 懒加载视图组件，好让初始包体保持小 ── */
/* 只有 HomePage / WorkspaceNav / ToastProvider / VideoQueueModal 是即时加载的。 */
const SettingsOverlay = dynamic(
  () =>
    import("~/components/settings/SettingsOverlay").then(
      (mod) => mod.SettingsOverlay,
    ),
  { ssr: false },
);

const WorksGallery = dynamic(
  () => import("~/components/studio").then((mod) => mod.WorksGallery),
  { ssr: false },
);
const ProjectOutputs = dynamic(
  () => import("~/components/studio").then((mod) => mod.ProjectOutputs),
  { ssr: false },
);
const ModelLibrary = dynamic(
  () => import("~/components/studio").then((mod) => mod.ModelLibrary),
  { ssr: false },
);
const HistoryList = dynamic(
  () => import("~/components/studio").then((mod) => mod.HistoryList),
  { ssr: false },
);
const TrainingStudio = dynamic(
  () => import("~/components/studio").then((mod) => mod.TrainingStudio),
  { ssr: false },
);
const WorkflowLibrary = dynamic(
  () => import("~/components/studio").then((mod) => mod.WorkflowLibrary),
  { ssr: false },
);

/* 客户端上懒加载更重的画布 / 影片编辑器（ReactFlow 等）。 */
const FilmStudio = dynamic(
  () => import("~/components/studio/FilmStudio").then((mod) => mod.FilmStudio),
  { ssr: false },
);
const ProjectCanvas = dynamic(
  () =>
    import("~/components/studio/ProjectCanvas").then(
      (mod) => mod.ProjectCanvas,
    ),
  { ssr: false },
);

/* ── 工作区页面 —— Updream 风全屏编辑器 ── */

/* 离开 /workspace 到其它顶层路由（如 /settings）再返回时，Next.js 会重新
 * 挂载本页面组件导致 viewMode 重置回 home。用 sessionStorage 保存最近一次
 * 视图，组件重新挂载时据此恢复，避免「设置打开→关闭后回到默认界面」。
 * 仅在导航离开 /workspace 时才触发恢复（cleanup 只在本页面被卸载时执行）。 */
const WS_VIEW_KEY = "comfyapp:workspace-view-v1";

const WORKSPACE_VIEWS: WorkspaceView[] = [
  "home",
  "canvas",
  "models",
  "works",
  "workshop",
  "history",
  "train",
  "film",
  "workflows",
  "outputs",
];

function readLastView(): WorkspaceView {
  if (typeof window === "undefined") return "home";
  const raw = sessionStorage.getItem(WS_VIEW_KEY);
  if (!raw) return "home";
  const view = WORKSPACE_VIEWS.find((v) => v === raw);
  return view ?? "home";
}

function writeLastView(view: WorkspaceView): void {
  if (typeof window === "undefined") return;
  sessionStorage.setItem(WS_VIEW_KEY, view);
}

function ago(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "刚刚修改";
  if (m < 60) return `${m} 分钟前修改`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} 小时前修改`;
  return `${Math.floor(h / 24)} 天前修改`;
}

export default function WorkspacePage() {
  const router = useRouter();

  // ── Layout state ──
  const [viewMode, setViewMode] = useState<WorkspaceView>("home");

  /* 从 sessionStorage 恢复离开 workspace 前（如跳去 /settings）的视图。
   * 不能把 readLastView 放进 useState 初始值——SSR 阶段 window 不可用返回 home，
   * hydration 不会重新执行 initializer，sessionStorage 恢复就永远不生效。 */
  useEffect(() => {
    const saved = readLastView();
    if (saved !== "home") {
      // 跳过 hydration 窗口后恢复视图，避免对 SSR 渲染树造成级联 setState。
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setViewMode(saved);
    }
  }, []);
  // 视**图**历史栈，用于智能返回导航（避免一跳就回首页）
  const [, setViewHistory] = useState<WorkspaceView[]>(["home"]);

  /** 跳到新视图，同时记录历史以支持返回按钮。 */
  const navigateTo = useCallback((view: WorkspaceView) => {
    setViewHistory((prev) => {
      const last = prev[prev.length - 1];
      if (last === view) return prev; // dedup
      return [...prev, view];
    });
    setViewMode(view);
    writeLastView(view);
  }, []);

  // ── 视频队列弹窗 ──
  const [videoQueueOpen, setVideoQueueOpen] = useState(false);

  // ── Settings overlay ──
  // 设置以 overlay 形式打开（而非跳转 /settings 独立路由），保持 workspace
  // 组件树常驻——关闭设置后当前视图的选中项/编辑内容原样保留。
  const [settingsOpen, setSettingsOpen] = useState(false);
  const openSettings = useCallback(() => setSettingsOpen(true), []);
  const closeSettings = useCallback(() => setSettingsOpen(false), []);

  // ── 画布：为 true 时，画布打开一个全新的命名项目
  const [canvasSeedNew, setCanvasSeedNew] = useState(false);

  // ── 自增以重新读取 canvas-store（最近项目） ──
  const [recentsKey] = useState(0);

  // ── 设置后，无限画布接收这条工作流并为它放一个
  //    `kind="workflow"` 节点（来自工作流库的「使用」动作）。
  const [pendingCanvasWorkflow, setPendingCanvasWorkflow] = useState<{
    id: string;
    name: string;
    taskType: string;
  } | null>(null);

  // ── 最近项目：来源是 canvas-store（localStorage），不是 Task 表。
  //    Task.type 只接受 TXT2IMG|IMG2IMG|INPAINT|HIRERES|VIDEO，所以画布
  //    项目永远不会出现在那里。从 listProjects() 读取能保证
  //    「最近项目」区反映用户真实的画布工作。
  // ── 挂载时 + store 变化事件时加载真实的最近画布项目 ──
  //    存在 localStorage（canvas-store），所以 SSR 返回 []；我们挂载后
  //    再水合。"comfyapp:canvas-store-changed" 事件让首页
  //    视图与 ProjectCanvas 里的编辑（upsert / delete
  //    / rename）保持同步，无需整页重载。
  const [recentProjects, setRecentProjects] = useState<RecentProject[]>([]);
  useEffect(() => {
    // 在首页挂载时做一次性清扫：移除较早代码版本
    // 留在索引里的陈旧空默认名草稿。
    // 若真清掉了东西就触发 `comfyapp:canvas-store-changed`，好让
    // 下面的刷新回调重读 `listProjects()`，首页最近项目列表
    // 无需硬重载就保持干净。
    reapAllEmptyDrafts();
    const compute = () => {
      setRecentProjects(
        listProjects()
          .slice(0, 8) // 给 HomePage 内部 recentsExpanded ? 7 : 3 切片留余量
          .map((project) => {
            const nodeCount = project.nodes?.length ?? 0;
            const edgeCount = project.edges?.length ?? 0;
            return {
              id: project.id,
              name: (project.name || "未命名项目").slice(0, 28),
              updatedAt: project.updatedAt
                ? ago(new Date(project.updatedAt).toISOString())
                : "刚刚",
              kind: "canvas" as const,
              subtitle:
                nodeCount > 0
                  ? `${nodeCount} 节点 · ${edgeCount} 连线`
                  : "空画布",
              thumbnails: [],
            };
          }),
      );
    };
    compute();
    const refresh = () => compute();
    window.addEventListener("comfyapp:canvas-store-changed", refresh);
    return () =>
      window.removeEventListener("comfyapp:canvas-store-changed", refresh);
  }, [recentsKey]);

  // ── Handlers ──
  const handleNavSelect = useCallback(
    (id: WorkspaceView) => {
      navigateTo(id);
    },
    [navigateTo],
  );

  const handleNewProject = useCallback(() => {
    // 打开「新建项目」会把用户带进一个全新的命名画布项目
    //（上一个项目保留在项目 store 里）。
    setCanvasSeedNew(true);
    navigateTo("canvas");
  }, [navigateTo]);

  // 打开一个画布项目 —— 设为活跃并跳到画布视图。
  const handleOpenCanvasProject = useCallback(
    (id: string) => {
      setActive(id);
      navigateTo("canvas");
    },
    [navigateTo],
  );

  const handleHomeNavigate = useCallback(
    (view: WorkspaceView) => {
      // 接受任何已注册的 WorkspaceView id；"home" 就是当前视图，
      // 所以再点它是个空操作。
      if (view === "home") return;
      navigateTo(view);
    },
    [navigateTo],
  );

  // HomePage "查看全部" → switch to the "项目" (works) tab.
  const handleShowAllProjects = useCallback(() => {
    navigateTo("works");
  }, [navigateTo]);

  const handleOpenProject = useCallback(
    (id: string) => {
      if (id === "new") {
        // 原 "新建项目" 创作台已移除，改为直接进入画布
        setCanvasSeedNew(true);
        navigateTo("canvas");
      } else {
        // 真实作品：跳转作品详情页（溯源 + 执行日志）
        router.push(`/create/${id}`);
      }
    },
    [navigateTo, router],
  );

  // 从工作流库「使用」一条工作流 → 跳到无限画布
  // 并把该工作流作为节点放到当前打开的项目上。
  const handleUseWorkflow = useCallback(
    (id: string, meta?: { name: string; taskType: string }) => {
      setPendingCanvasWorkflow({
        id,
        name: meta?.name ?? "",
        taskType: meta?.taskType ?? "",
      });
      navigateTo("canvas");
    },
    [navigateTo],
  );

  // ── Home 模式为整页独立视图；其余模式共用左侧导航 + 中央内容 ──
  // LogProvider/ToastProvider 全页只挂载一层：此前两个分支各自包一层，home ↔
  // 其它模式切换会反复装卸 console 包装（makeLogger 双重嵌套），是日志观察者
  // 自身报错的结构性诱因（LogProvider Console Error）。
  const renderCenter = () => {
    switch (viewMode) {
      case "works":
        return (
          <WorksGallery
            onOpenTask={handleOpenProject}
            onOpenCanvasProject={handleOpenCanvasProject}
          />
        );

      case "models":
        return <ModelLibrary />;

      case "history":
        return <HistoryList onOpenTask={handleOpenProject} />;

      case "train":
        return <TrainingStudio onOpenSettings={openSettings} />;

      case "canvas":
        return (
          <ProjectCanvas
            seedNew={canvasSeedNew}
            onConsumeSeed={() => setCanvasSeedNew(false)}
            pendingWorkflow={pendingCanvasWorkflow}
            onConsumePending={() => setPendingCanvasWorkflow(null)}
          />
        );

      case "film":
        return <FilmStudio />;

      case "workflows":
        return <WorkflowLibrary onUse={handleUseWorkflow} />;

      case "outputs":
        return <ProjectOutputs />;

      case "workshop":
        return (
          <div className="h-full overflow-y-auto">
            <WorkshopPipeline />
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <ShellTabs>
      <>
        {/* 日志/Toast Provider 与底部状态栏已全局挂载（根布局），此处不再重复包裹 */}
        {viewMode === "home" ? (
          <>
            <HomePage
              onNewProject={handleNewProject}
              recentProjects={recentProjects}
              onOpenProject={handleOpenProject}
              onOpenCanvasProject={handleOpenCanvasProject}
              activeNav="home"
              onNavigate={handleHomeNavigate}
              onShowAllProjects={handleShowAllProjects}
              onOpenSettings={openSettings}
            />
            <VideoQueueModal
              open={videoQueueOpen}
              onClose={() => setVideoQueueOpen(false)}
            />
          </>
        ) : (
          <>
            <div
              className="bg-canvas text-ink flex h-full w-full overflow-hidden"
              style={{ fontFamily: "var(--font-sans)" }}
            >
              {/* 极光背景：暗色基底上浮动的紫/青/品红发光，给非 home 视图加空间纵深感 */}
              <AuroraBackground />

              <WorkspaceNav
                active={viewMode}
                onSelect={handleNavSelect}
                onOpenSettings={openSettings}
              />

              <div className="flex min-w-0 flex-1 flex-col">
                {renderCenter()}
              </div>

              <VideoQueueModal
                open={videoQueueOpen}
                onClose={() => setVideoQueueOpen(false)}
                onOpenTask={(id) => {
                  setVideoQueueOpen(false);
                  // 直接跳转到作品详情页（溯源 + 执行日志）
                  router.push(`/create/${id}`);
                }}
              />
            </div>
          </>
        )}

        {/* 设置 overlay：仅打开时挂载。置于最顶层，不卸载下方 workspace 组件树。 */}
        {settingsOpen && <SettingsOverlay onClose={closeSettings} />}
      </>
    </ShellTabs>
  );
}
