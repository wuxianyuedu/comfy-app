"use client";

import { subscribeAppEvent } from "~/lib/app-events";
import { useRef, useState, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import {
  VideoQueueModal,
  HomePage,
  AppShell,
  AuroraBackground,
} from "~/components/studio";
import {
  LEGACY_WS_VIEW_KEY,
  WS_TABS_KEY,
  HOME_VIEW,
  findTab,
  homeTab,
  initialWorkspaceTabs,
  makeTab,
  openViewTab,
  parseWorkspaceTabs,
  serializeWorkspaceTabs,
  type WorkspaceTabsState,
} from "~/components/studio/workspace-tabs";
import type { RecentProject, WorkspaceView } from "~/components/studio";
import { WorkshopPipeline } from "~/components/workshop/WorkshopPipeline";
import { ProjectGate } from "~/components/studio/ProjectGate";
import { ProjectTabBar } from "~/components/studio/ProjectTabBar";
import { isProjectTab } from "~/components/studio/NavItems";
import { ShellTabs } from "~/components/studio/ShellTabs";
import { timeAgo } from "~/lib/time-format";
import {
  createProject,
  getActiveId,
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
/* 资源库：整页素材管理（分类 / 搜索 / 上传 / 删除），与画布那块抽屉同源取数。 */
const ResourceLibrary = dynamic(
  () =>
    import("~/components/studio/library/ResourceLibrary").then(
      (mod) => mod.ResourceLibrary,
    ),
  { ssr: false },
);
const ModelLibrary = dynamic(
  () => import("~/components/studio").then((mod) => mod.ModelLibrary),
  { ssr: false },
);
/* 项目主页：进入项目后的落点。懒加载 —— 它与画布 / 工坊一样只在进项目后需要，
 * 放在应用首页的初始包里没有收益。 */
const ProjectHomePage = dynamic(
  () =>
    import("~/components/studio/project-home").then(
      (mod) => mod.ProjectHomePage,
    ),
  { ssr: false },
);
const HistoryList = dynamic(
  () => import("~/components/studio").then((mod) => mod.HistoryList),
  { ssr: false },
);
/* 队列与运行：与历史同族（都在看「机器现在在干什么」），只在进入该视图时才拉。 */
const QueueMonitor = dynamic(
  () =>
    import("~/components/studio/queue/QueueMonitor").then(
      (mod) => mod.QueueMonitor,
    ),
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

/* 离开 /workspace 到其它顶层路由（如 /settings）再返回时，Next.js 会重新挂载本页面
 * 组件。用 sessionStorage 存**页签列表 + 当前页签**，重新挂载时据此恢复。
 *
 * 旧键 `LEGACY_WS_VIEW_KEY` 存的是单个视图，这里只做一次性迁移、读到即删 —— 不留两个
 * 名字指同一件事（§12.14），也不允许"两个键各存一半、恢复时看谁先到"。
 * 旧键若指向项目类视图（工坊/画布…），迁移时没有项目 id 可绑，按不可用处理回落首页：
 * 这不是丢功能，那一条旧值本来就已经无法还原成一个合法页签。 */
const WORKSPACE_VIEWS: WorkspaceView[] = [
  "home",
  "project",
  "canvas",
  "models",
  "works",
  "workshop",
  "library",
  "history",
  "queue",
  "train",
  "film",
  "workflows",
  "outputs",
];

function readTabsState(): WorkspaceTabsState | null {
  if (typeof window === "undefined") return null;
  const raw = sessionStorage.getItem(WS_TABS_KEY);
  if (raw) return parseWorkspaceTabs(raw, WORKSPACE_VIEWS);

  const legacy = sessionStorage.getItem(LEGACY_WS_VIEW_KEY);
  if (legacy) sessionStorage.removeItem(LEGACY_WS_VIEW_KEY);
  if (!legacy) return null;
  const view = WORKSPACE_VIEWS.find((candidate) => candidate === legacy);
  if (!view || view === HOME_VIEW) return null;
  const tab = makeTab(view, null);
  if (!tab) return null;
  return { tabs: [homeTab(), tab], activeKey: tab.key };
}

function writeTabsState(state: WorkspaceTabsState): void {
  if (typeof window === "undefined") return;
  sessionStorage.setItem(WS_TABS_KEY, serializeWorkspaceTabs(state));
}

/** 视图历史栈保留上限（P2：只去重不裁剪会无限增长）。 */
const WORKSPACE_VIEW_HISTORY_MAX = 50;

export default function WorkspacePage() {
  const router = useRouter();

  // ── Layout state ──
  /* 页签状态取代单值 `viewMode`；`viewMode` 保留为**推导值**，下面的渲染分支
     一字不改 —— 这一刀只换状态模型与持久化，界面不变（页签条 UI 在下一刀）。 */
  const [tabsState, setTabsState] =
    useState<WorkspaceTabsState>(initialWorkspaceTabs);
  const viewMode: WorkspaceView =
    findTab(tabsState.tabs, tabsState.activeKey)?.view ?? HOME_VIEW;

  /* 恢复上次离开时的页签。不能放进 useState 初始值 —— SSR 阶段读不到 sessionStorage，
     而 hydration 不会重跑 initializer，恢复就永远不生效（与旧实现同一约定）。 */
  const tabsHydratedRef = useRef(false);
  useEffect(() => {
    const restored = readTabsState();
    // 无论恢复成不成功，从这一步起才允许落盘。
    tabsHydratedRef.current = true;
    if (restored) {
      // 跳过 hydration 窗口后恢复视图，避免对 SSR 渲染树造成级联 setState。
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setTabsState(restored);
    }
  }, []);
  useEffect(() => {
    /* 恢复那一步之前**不落盘**：否则挂载这一轮会先把初始态（只有首页一页）写进
       sessionStorage，把用户存好的列表冲掉，随后才读到空。 */
    if (!tabsHydratedRef.current) return;
    writeTabsState(tabsState);
  }, [tabsState]);
  // 视**图**历史栈，用于智能返回导航（避免一跳就回首页）
  const [, setViewHistory] = useState<WorkspaceView[]>(["home"]);

  /** 打开/聚焦一个视图页签，同时记录历史以支持返回按钮。 */
  const navigateTo = useCallback((view: WorkspaceView) => {
    setViewHistory((prev) => {
      const last = prev[prev.length - 1];
      if (last === view) return prev; // dedup
      // 历史栈只去重不裁剪会无限增长（P2）；保留最近一段即可，更早的用不到。
      return [...prev, view].slice(-WORKSPACE_VIEW_HISTORY_MAX);
    });
    /* 绑的是 store 的同步读数，不是 `activeProjectId` 那个 React 状态：
       「打开项目」的 handler 里 `setActive(id)` 与 `navigateTo("project")` 是同一次
       事件里先后调用的，读状态会拿到旧值 ⇒ 项目页签被开成"无项目"或直接丢绑。 */
    const projectId = getActiveId();
    setTabsState((prev) => openViewTab(prev, view, projectId));
  }, []);

  /* 「请求切到某个视图」的应用事件订阅（唯一订阅侧）。
   * 触发方是工坊右栏的「资源库」卡 —— 那条链路上有 WorkshopPipeline /
   * WorkshopAside 两层，穿 props 不划算（见 `lib/app-events` 里本事件的说明）。
   * 载荷是字符串，这里按 `WORKSPACE_VIEWS` 收敛：未知 id 直接忽略，
   * 不让它把 `viewMode` 带进一个无分支可渲染的状态。 */
  useEffect(
    () =>
      subscribeAppEvent("workspace:navigate", ({ view }) => {
        const target = WORKSPACE_VIEWS.find((candidate) => candidate === view);
        if (target) navigateTo(target);
      }),
    [navigateTo],
  );

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

  // ── 当前活跃项目 id（项目闸门的判据）：来源 canvas-store 的 active 键，
  //    只在客户端可读，SSR 首帧为 null。订阅 store 变化事件保持同步。
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const refreshActiveProject = useCallback(
    () => setActiveProjectId(getActiveId()),
    [],
  );
  useEffect(() => {
    // 首帧后同步一次活跃项目 id（getActiveId 只在客户端可读，SSR 为 null）；
    // 与本文件恢复视图处同一约定。订阅回调里的 setState 属合规的外部同步。
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refreshActiveProject();
    return subscribeAppEvent("comfyapp:canvas-store-changed", () =>
      refreshActiveProject(),
    );
  }, [refreshActiveProject]);

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
                ? (timeAgo(project.updatedAt, { suffix: "修改" }) ?? "刚刚修改")
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
    /* 重新读取靠**应用事件**（`comfyapp:canvas-store-changed`），不靠依赖数组
     * —— 收口前这里挂着一个 `useState(0)` 的「票据」却从不自增（注释还写着
     * 「自增以重新读取」），那个依赖项从来没起过作用（规范 16 §16.2.4.70）。 */
    return subscribeAppEvent("comfyapp:canvas-store-changed", compute);
  }, []);

  // ── Handlers ──
  const handleNavSelect = useCallback(
    (id: WorkspaceView) => {
      navigateTo(id);
    },
    [navigateTo],
  );

  const handleNewProject = useCallback(() => {
    // 统一「新建项目」入口：创建一个真实的 proj_* 项目（落库 + 设为活跃），
    // 画布/工坊/成片后续都挂在这个项目上（Phase 1 先立画布为脊柱）。
    // 落点是**项目主页**：新项目还没有任何内容，直接进画布是一张空网
    //（进去之后仍然只能得到「先回主页看看项目要干什么」）；主页给出
    // 状态与「AI 自主成片」这条主动作，是更合适的起步位置。
    createProject();
    refreshActiveProject();
    navigateTo("project");
  }, [navigateTo, refreshActiveProject]);

  /* 打开一个项目 —— 设为活跃并落到**项目主页**。
   *
   * 此前落画布，于是「一进项目就是一张无限画布」，用户看不到这个项目做到哪了
   *（画布只表达节点图，不表达阶段 / 素材 / 成片）。主页是项目级视图的入口，
   * 想去画布再从页签切一步。 */
  const handleOpenCanvasProject = useCallback(
    (id: string) => {
      setActive(id);
      navigateTo("project");
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
        // 统一新建项目：创建真实 proj_* 并进入项目主页（与 handleNewProject 一致）。
        createProject();
        refreshActiveProject();
        navigateTo("project");
      } else {
        // 真实作品：跳转作品详情页（溯源 + 执行日志）
        router.push(`/create/${id}`);
      }
    },
    [navigateTo, router, refreshActiveProject],
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
    // 项目优先闸门：进入项目界面（主页 / 画布 / 工坊 / 资源库 / 产出 / 成片）前必须先有一个活跃项目。
    if (isProjectTab(viewMode) && !activeProjectId) {
      return (
        <ProjectGate
          onEnter={refreshActiveProject}
          onExit={() => navigateTo("home")}
        />
      );
    }
    switch (viewMode) {
      case "project":
        return (
          <ProjectHomePage
            projectName={
              recentProjects.find((p) => p.id === activeProjectId)?.name ??
              "未命名项目"
            }
            onNavigate={handleNavSelect}
          />
        );

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

      case "queue":
        return <QueueMonitor onOpenSettings={openSettings} />;

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

      case "library":
        return <ResourceLibrary />;

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
        {/* 侧栏 + 顶栏 + 主内容容器都归 `AppShell`（规范 §12.1 规划的壳层）。
            home 与其余视图共用同一套导航与工具条 —— 此前是「首页自带内联侧栏与
            顶栏 / 其余视图用 64px 自绘竖排导航条」两套形态，属历史遗留。 */}
        <AppShell
          active={viewMode}
          onSelect={handleNavSelect}
          onOpenSettings={openSettings}
          projects={recentProjects.map((p) => ({ id: p.id, name: p.name }))}
          activeProjectId={activeProjectId}
          onOpenProject={handleOpenCanvasProject}
          onShowAllProjects={handleShowAllProjects}
          onNewProject={handleNewProject}
        >
          {viewMode === "home" ? (
            <HomePage
              onNewProject={handleNewProject}
              recentProjects={recentProjects}
              onOpenProject={handleOpenProject}
              onOpenCanvasProject={handleOpenCanvasProject}
              onNavigate={handleHomeNavigate}
              onShowAllProjects={handleShowAllProjects}
            />
          ) : (
            <>
              {/* 极光背景：暗色基底上浮动的紫/青/品红发光，给非 home 视图加空间纵深感 */}
              <AuroraBackground />
              {/* 项目界面顶部的切换器：仅在已有一个活跃项目、且当前是项目页签时出现
                  （无项目时 renderCenter 会先落到 ProjectGate，不必在其上叠一排页签）。 */}
              {isProjectTab(viewMode) && activeProjectId ? (
                <ProjectTabBar
                  active={viewMode}
                  onSelect={handleNavSelect}
                  projectName={
                    recentProjects.find((p) => p.id === activeProjectId)?.name
                  }
                />
              ) : null}
              {renderCenter()}
            </>
          )}
        </AppShell>

        {/* 视频队列弹窗：两个视图分支此前各挂一份同构实例，合并为一处。 */}
        <VideoQueueModal
          open={videoQueueOpen}
          onClose={() => setVideoQueueOpen(false)}
          onOpenTask={(id) => {
            setVideoQueueOpen(false);
            // 直接跳转到作品详情页（溯源 + 执行日志）
            router.push(`/create/${id}`);
          }}
        />

        {/* 设置 overlay：仅打开时挂载。置于最顶层，不卸载下方 workspace 组件树。 */}
        {settingsOpen && <SettingsOverlay onClose={closeSettings} />}
      </>
    </ShellTabs>
  );
}
