"use client";

/* ── WorkspaceViewStack · 打开的每一页视图的**常驻栈** ─────────────────
 *
 * 这是「页签让打开的界面保持打开」这条诉求的落点（ISSUE #1784 第 1 条）。
 * 收口前 `workspace/page.tsx` 用 `switch (viewMode)` 只渲染当前那一屏 ——
 * 切走即卸载：切回画布是一张重开的空网、控制台里跑着的命令断连、工坊草稿没了。
 * 现在按**页签列表**逐屏取内容、叠在一起用 CSS 显隐切换，卸载只发生在关掉那一页时。
 *
 * 为什么单独一个组件而不是继续留在页面里：
 *   · 页面那个函数已经在函数长度阈值附近（规范 §12.13，400 行），再把 13 个
 *     视图的分支摊在里面就超了 —— 而这条判据要的是**按职责拆**，不是加注释分段；
 *   · 十二份 `next/dynamic` 的懒加载声明与「哪一屏对应哪个组件」是同一条知识，
 *     收在一处才不会漂（收口前它们散在页面顶部 100 行里）。
 *
 * 显隐用 `hidden`（`display:none`）+ `h-full`，与壳页签 `ShellTabs` 对 iframe
 * 的做法同一套：切显隐不碰 React 的挂载状态。非当前页补 `aria-hidden`，
 * 读屏不会读到屏幕外那一屏（读屏用户不该被十个隐藏视图挨个念一遍）。
 */

import dynamic from "next/dynamic";

import {
  HomePage,
  AuroraBackground,
  WorksGallery,
  ProjectOutputs,
  ModelLibrary,
  HistoryList,
  WorkflowLibrary,
} from "~/components/studio";
import type { RecentProject } from "~/components/studio";
import { WorkshopPipeline } from "~/components/workshop/WorkshopPipeline";
import { ProjectGate } from "~/components/studio/ProjectGate";
import { isProjectTab } from "~/components/studio/NavItems";
import type { ViewTab } from "./workspace-tabs";
import type { WorkspaceView } from "./NavItems";
import { ViewTabActiveProvider } from "./ViewActions";

/* ── 懒加载视图组件，好让初始包体保持小 ── */
/* 只有 HomePage / AuroraBackground / VideoQueueModal（在页面侧）是即时加载的。 */
/* 设置（与历史 / 队列 / 控制台同族，都是「项目无关的全局视图」）：只在进入该
 * 视图时才拉 —— 它带着全部配置查询与 Ollama 探测，不该摊到别的视图首屏。 */
const SettingsView = dynamic(
  () =>
    import("~/components/settings/SettingsView").then((m) => m.SettingsView),
  { ssr: false },
);

/* 模型适配 / 模式契约：与设置同一族（项目无关的全局配置视图）。 */
const ModelAdaptersView = dynamic(
  () =>
    import("~/components/workshop/ModelAdaptersView").then(
      (mod) => mod.ModelAdaptersView,
    ),
  { ssr: false },
);
const ModeContractView = dynamic(
  () =>
    import("~/components/workshop/mode-contract/ModeContractView").then(
      (mod) => mod.ModeContractView,
    ),
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

/* 项目主页：进入项目后的落点。懒加载 —— 它与画布 / 工坊一样只在进项目后需要，
 * 放在应用首页的初始包里没有收益。 */
const ProjectHomePage = dynamic(
  () =>
    import("~/components/studio/project-home").then(
      (mod) => mod.ProjectHomePage,
    ),
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

/* 控制台（ISSUE #1327）：与历史 / 队列同族（都是「项目无关的全局视图」）。 */
const ConsoleView = dynamic(
  () => import("~/components/console/ConsoleView").then((m) => m.ConsoleView),
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

/** 页面侧交给视图栈的全部接线 —— 每一屏要用什么都在这里，栈自己不取数。 */
export interface WorkspaceViewStackProps {
  /** 打开的页签（顺序即叠放顺序；`ViewTab.key` 当 React key 与锚点）。 */
  tabs: ViewTab[];
  /** 当前页签 key。 */
  activeKey: string;
  /** 活跃项目 id —— 项目类视图与「项目优先闸门」判据。 */
  activeProjectId: string | null;
  /** 最近项目（项目主页取名字用）。 */
  recentProjects: RecentProject[];
  /** 项目页签无活跃项目时，闸门的两个出口。 */
  onEnterProject: () => void;
  onExitProject: () => void;
  onNewProject: () => void;
  onOpenProject: (id: string) => void;
  onOpenCanvasProject: (id: string) => void;
  /** 项目视图内部的跳转（项目主页的四张卡）。 */
  onNavigate: (view: WorkspaceView) => void;
  /** 首页入口卡的跳转 —— 与 `onNavigate` 分开：首页把「再点首页」当空操作。 */
  onHomeNavigate: (view: WorkspaceView) => void;
  onShowAllProjects: () => void;
  onOpenSettings: () => void;
  onUseWorkflow: (
    id: string,
    meta?: { name: string; taskType: string },
  ) => void;
  /** 画布：开一个新命名项目 / 消费这两枚一次性载荷。 */
  canvasSeedNew: boolean;
  onConsumeCanvasSeed: () => void;
  pendingCanvasWorkflow: { id: string; name: string; taskType: string } | null;
  onConsumePendingWorkflow: () => void;
}

export function WorkspaceViewStack({
  tabs,
  activeKey,
  activeProjectId,
  recentProjects,
  onEnterProject,
  onExitProject,
  onNewProject,
  onOpenProject,
  onOpenCanvasProject,
  onNavigate,
  onHomeNavigate,
  onShowAllProjects,
  onOpenSettings,
  onUseWorkflow,
  canvasSeedNew,
  onConsumeCanvasSeed,
  pendingCanvasWorkflow,
  onConsumePendingWorkflow,
}: WorkspaceViewStackProps) {
  /**
   * 某一个视图该渲染什么 —— **按视图取值**，不再按「当前视图」取值。
   *
   * 判据里只认 `view`（页签的视图），项目用 `activeProjectId`：项目页签与活跃项目
   * 的绑定在 `openViewTab` 时已确定，这里不重复判断绑定关系。
   */
  const renderView = (view: WorkspaceView) => {
    if (view === "home") {
      return (
        <HomePage
          onNewProject={onNewProject}
          recentProjects={recentProjects}
          onOpenProject={onOpenProject}
          onOpenCanvasProject={onOpenCanvasProject}
          onNavigate={onHomeNavigate}
          onShowAllProjects={onShowAllProjects}
        />
      );
    }
    // 项目优先闸门：进入项目界面（主页 / 画布 / 工坊 / 资源库 / 产出 / 成片）前必须先有一个活跃项目。
    if (isProjectTab(view) && !activeProjectId) {
      return <ProjectGate onEnter={onEnterProject} onExit={onExitProject} />;
    }
    switch (view) {
      case "project":
        return (
          <ProjectHomePage
            projectName={
              recentProjects.find((p) => p.id === activeProjectId)?.name ??
              "未命名项目"
            }
            onNavigate={onNavigate}
          />
        );

      case "works":
        return (
          <WorksGallery
            onOpenTask={onOpenProject}
            onOpenCanvasProject={onOpenCanvasProject}
          />
        );

      case "models":
        return <ModelLibrary />;

      case "history":
        return <HistoryList onOpenTask={onOpenProject} />;

      case "queue":
        return <QueueMonitor onOpenSettings={onOpenSettings} />;

      case "settings":
        return <SettingsView fillHeight />;

      case "model-adapters":
        return <ModelAdaptersView />;

      case "mode-contract":
        return <ModeContractView />;

      case "canvas":
        return (
          <ProjectCanvas
            seedNew={canvasSeedNew}
            onConsumeSeed={onConsumeCanvasSeed}
            pendingWorkflow={pendingCanvasWorkflow}
            onConsumePending={onConsumePendingWorkflow}
          />
        );

      case "film":
        return <FilmStudio />;

      case "workflows":
        return <WorkflowLibrary onUse={onUseWorkflow} />;

      case "console":
        return <ConsoleView />;

      case "outputs":
        return <ProjectOutputs />;

      case "library":
        return <ResourceLibrary />;

      case "workshop":
        return <WorkshopPipeline />;

      default:
        return null;
    }
  };

  return (
    <>
      {tabs.map((tab) => {
        const isActive = tab.key === activeKey;
        const isHome = tab.view === "home";
        return (
          <div
            key={tab.key}
            data-view={tab.view}
            aria-hidden={!isActive}
            className={isActive ? "h-full" : "hidden h-full"}
          >
            {/* 极光背景：暗色基底上浮动的紫/青/品红发光，给非 home 视图加空间纵深感。
                挂在各自的 wrapper 里（只有非 home 需要）——放在栈外层会让首页也多一层
                随视图切换重挂的装饰层。 */}
            {isHome ? null : <AuroraBackground />}
            {/* 「这一屏是不是当前页」：所有开过的屏都活着、也都会往顶栏的动作槽里
                送按钮，不按页签过滤就会「四屏的按钮挤在同一条顶栏里」（见
                `ViewActions` 里 `ViewTabActiveContext` 那段）。 */}
            <ViewTabActiveProvider active={isActive}>
              {renderView(tab.view)}
            </ViewTabActiveProvider>
          </div>
        );
      })}
    </>
  );
}
