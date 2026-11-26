"use client";

/* ── WorkspaceViewStack · 打开的每一页视图的**常驻栈** ─────────────────
 * 这是「页签让打开的界面保持打开」的落点（ISSUE #1784 第 1 条）：收口前 `workspace/page.tsx` 用 `switch (viewMode)` 只渲染当前那一屏、切走即卸载（切回画布是空网、控制台命令断连、工坊草稿没了）；现在按**页签列表**逐屏取内容、叠在一起用 CSS 显隐切换，卸载只发生在关掉那一页时。
 * 单独成组件：页面函数已在长度阈值附近（规范 §12.13，400 行）。显隐用 `hidden` + `h-full`（与 `ShellTabs` 对 iframe 同一套，不碰 React 挂载状态）；非当前页补 `aria-hidden`，读屏不会挨个念十个隐藏视图。
 * 懒加载声明统一在 `./LazyViews`（自愈 + 预热只有一份实现）；一项目一页签（ISSUE #4765）之后，画布 / 工坊 / 资源库 / 产出 / 成片由项目页容器（`ProjectWorkspace`）按左列表分区拉起，这里只剩「project」一个项目分支。
 */

import { useEffect, useMemo, useState } from "react";

import {
  HomePage,
  AuroraBackground,
  WorksGallery,
  ModelLibrary,
  HistoryList,
  WorkflowLibrary,
} from "~/components/studio";
import type { RecentProject } from "~/components/studio";
import { ProjectGate } from "~/components/studio/ProjectGate";
import { HeavyViewGate } from "~/components/studio/HeavyViewGate";
import { isProjectTab } from "~/components/studio/NavItems";
import type { ModelTestRetryPayload } from "~/components/studio/history/history-detail-derive";
import {
  AccessoryLibraryView,
  AssetLibraryView,
  CharacterLibraryView,
  ComfyuiControl,
  CostumeLibraryView,
  ConsoleView,
  FaceLibraryView,
  ModeContractView,
  ModelAdaptersView,
  ModelTestView,
  QueueMonitor,
  SettingsView,
  StyleLibraryView,
  UIKitGalleryView,
  isLazyView,
} from "./LazyViews";
import { ProjectWorkspace } from "./project-workspace/ProjectWorkspace";
import type { ViewTab } from "./workspace-tabs";
import type { WorkspaceView } from "./NavItems";
import { ViewTabActiveProvider } from "./ViewActions";
import { ViewOpenReport, ViewOpenedAtContext, type ViewOpenedAtLookup } from "./ViewOpenReport";
import { startLazyViewPrefetch } from "./lazy-view-prefetch";

/**
 * 非活跃时降级为「DOM 摘除但状态保留」的视图（ISSUE #4677 落地三屏，#4878 扩面）。
 *
 * React Activity 的 hidden 模式让隐藏页签不因页签切换 / 父级状态 / 兄弟屏事件做任何
 * 渲染，同时保留组件内部状态（表单草稿 / 展开态 / 选中）；effects 在切回时重挂，
 * 与既有 `enabled: isTabActive` / `pauseWhenViewHidden` 的轮询门控同一拍。
 *
 * 为什么从三屏扩到除首页 / 项目页之外的全部视图：#4878 的多页签现场 trace 显示
 * 切换时 `jsxDEV` 元素创建 ~892ms、effect 遍历 ~518ms —— 未受闸的 ComfyUI /
 * 工作流库 / 模型适配 / 测试模型 / 模式契约等整棵子树都在重渲染。这些屏的
 * 隐藏期状态没有「必须持续更新」的：ComfyUI 的 SSE、测试模型的轮询本就由
 * `isTabActive` 门控，控制台按设计切走即断流，表单草稿由 Activity 原样保留。
 *
 * 仍然排除的两类：
 *  · `home` —— 默认入口、极轻，常驻省一次切回重挂；
 *  · `project` —— ReactFlow 的视口 / 选中 / 撤销栈都在组件内部，降级要逐状态评估
 *    可丢性（#4677 留的题），风险与收益另算，不在这轮顺手改。
 */
const HEAVY_VIEWS = new Set<WorkspaceView>([
  "comfyui",
  "console",
  "history",
  "model-adapters",
  "model-test",
  "mode-contract",
  "models",
  "queue",
  "settings",
  "uiKit",
  "workflows",
  "works",
]);

/** 页面侧交给视图栈的全部接线 —— 每一屏要用什么都在这里，栈自己不取数。 */
export type WorkspaceViewStackProps = {
  /** 当前页签 key。 */
  activeKey: string;
  /** 当前页签对应的**视图**（同一视图两个页签算同一屏）—— 打开耗时按它归属。 */
  activeView: WorkspaceView;
  /** 一次性预填载荷消费完的回调（#4841）：测试模型视图落定后清工作区的 pending state。 */
  onConsumeModelTestRetry: () => void;
  onConsumePendingWorkflow: () => void;
  onConsumeSettingsSection: () => void;
  /** 删除一个项目（项目页内左列表底部的危险入口；上层删本地+服务端并关页签）。 */
  onDeleteProject: (projectId: string) => void;
  /** 项目页签无活跃项目时，闸门的两个出口。 */
  onEnterProject: () => void;
  onExitProject: () => void;
  /** 首页入口卡的跳转 —— 与 `onNavigate` 分开：首页把「再点首页」当空操作。 */
  onHomeNavigate: (view: WorkspaceView) => void;
  /** 项目视图内部的跳转（项目主页的四张卡）。 */
  onNavigate: (view: WorkspaceView) => void;
  onNewProject: () => void;
  onOpenCanvasProject: (id: string) => void;
  /** 队列屏的离线出口：切到侧栏「ComfyUI」页。 */
  onOpenComfyui: () => void;
  onOpenProject: (id: string) => void;
  /** 历史页「重试」折好的带参载荷（#4841）：工作区带到测试模型页预填 ——
   *  与 `pendingCanvasWorkflow` 同款的一次性载荷，落定后由 `onConsume…` 清。 */
  onReprintToModelTest: (payload: ModelTestRetryPayload) => void;
  onShowAllProjects: () => void;
  onUseWorkflow: (id: string, meta?: { name: string; taskType: string }) => void;
  pendingCanvasWorkflow: { id: string; name: string; taskType: string } | null;
  pendingModelTestRetry: ModelTestRetryPayload | null;
  /** 最近项目（项目主页取名字用）。 */
  recentProjects: Array<RecentProject>;
  /** 设置：跳转时指定的目标分区（一次性载荷，交给设置视图落定后消费）。 */
  settingsSection: string | null;
  /** 打开的页签（顺序即叠放顺序；`ViewTab.key` 当 React key 与锚点）。 */
  tabs: Array<ViewTab>;
};

export function WorkspaceViewStack({
  tabs,
  activeKey,
  activeView,
  recentProjects,
  onEnterProject,
  onExitProject,
  onNewProject,
  onOpenProject,
  onOpenCanvasProject,
  onNavigate,
  onHomeNavigate,
  onShowAllProjects,
  onOpenComfyui,
  onUseWorkflow,
  onConsumePendingWorkflow,
  pendingCanvasWorkflow,
  onDeleteProject,
  settingsSection,
  onConsumeSettingsSection,
  onReprintToModelTest,
  onConsumeModelTestRetry,
  pendingModelTestRetry,
}: WorkspaceViewStackProps) {
  /**
   * 某一个页签该渲染什么 —— **按页签取值**，不再按「当前视图」取值。项目类视图
   * 一律折叠成 view = "project" 的单页签（一项目一页签，ISSUE #4765），项目 id
   * 取**页签自己绑定的那份**（多项目页签同场时各渲染各的，不读全局活跃）。
   */
  const renderView = (tab: ViewTab) => {
    const view = tab.view;
    if (view === "home") {
      return (
        <HomePage
          onNavigate={onHomeNavigate}
          onNewProject={onNewProject}
          onOpenCanvasProject={onOpenCanvasProject}
          onOpenProject={onOpenProject}
          onShowAllProjects={onShowAllProjects}
          recentProjects={recentProjects}
        />
      );
    }
    // 项目优先闸门：进入项目界面（主页 / 画布 / 工坊 / 资源库 / 产出 / 成片）前必须先有项目。
    if (isProjectTab(view) && (tab.projectId === null || tab.projectId === "")) {
      return <ProjectGate onEnter={onEnterProject} onExit={onExitProject} />;
    }
    switch (view) {
      case "project": {
        return (
          <ProjectWorkspace
            onConsumePendingWorkflow={onConsumePendingWorkflow}
            onDeleteProject={onDeleteProject}
            onNavigate={onNavigate}
            pendingWorkflow={pendingCanvasWorkflow}
            projectId={tab.projectId ?? ""}
            projectName={recentProjects.find((p) => p.id === tab.projectId)?.name ?? "未命名项目"}
          />
        );
      }

      case "works": {
        return (
          <WorksGallery onOpenCanvasProject={onOpenCanvasProject} onOpenTask={onOpenProject} />
        );
      }

      case "models": {
        return <ModelLibrary />;
      }

      case "history": {
        return (
          <HistoryList onOpenTask={onOpenProject} onReprintToModelTest={onReprintToModelTest} />
        );
      }

      case "queue": {
        return <QueueMonitor onOpenComfyui={onOpenComfyui} />;
      }

      case "assets": {
        return <AssetLibraryView />;
      }

      case "characters": {
        return <CharacterLibraryView />;
      }

      case "style": {
        return <StyleLibraryView />;
      }

      case "face": {
        return <FaceLibraryView />;
      }

      case "costumes": {
        return <CostumeLibraryView />;
      }

      case "accessories": {
        return <AccessoryLibraryView />;
      }

      case "comfyui": {
        return <ComfyuiControl />;
      }

      case "settings": {
        return (
          <SettingsView
            fillHeight
            initialSection={settingsSection}
            onConsumeSection={onConsumeSettingsSection}
          />
        );
      }

      case "model-adapters": {
        return <ModelAdaptersView />;
      }

      case "model-test": {
        return (
          <ModelTestView
            onConsumeReprint={onConsumeModelTestRetry}
            pendingReprint={pendingModelTestRetry}
          />
        );
      }

      case "mode-contract": {
        return <ModeContractView />;
      }

      case "uiKit": {
        /* 与 settings 同形：页签里由本栈的 `h-full` 给出高度，控件总览自己那根
         * 滚动条才滚得起来（ISSUE #3798）。独立路由 `/ui-kit` 不传，走视口档。 */
        return <UIKitGalleryView fillHeight />;
      }

      case "workflows": {
        return <WorkflowLibrary onUse={onUseWorkflow} />;
      }

      case "console": {
        return <ConsoleView />;
      }

      default: {
        return null;
      }
    }
  };

  /* 当前屏「打开时刻」的记账 —— 交给 `ViewOpenReport` 在内容挂载点多读一次，由它算出「内容真的出现」减去这一步的耗时。
   * 为什么是**成对**的 `{ view, at }` 而不是裸时刻：时刻与对应视图必须绑一起，否则「刚激活、时刻还没换」那一帧里，新视图会拿到上一屏的旧时刻、算出垃圾耗时（React 子 effect 先于父 effect，内容侧先读到 provider）；绑成一对后该帧读到 `null`（视图对不上）⇒ 只记一条正确的。
   * 计时刻意放在 **effect** 里：渲染期调用 `performance.now()` 属 React 的不纯调用（`react-hooks/purity` 会红），effect 里则合规。 */
  const [opened, setOpened] = useState<{
    at: number;
    view: WorkspaceView;
  } | null>(null);
  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect
    setOpened({ view: activeView, at: performance.now() });
  }, [activeView]);

  /* 懒加载分块的空闲预热：挂载即启动（幂等，StrictMode 双跑只排一次）。
   * 为什么要它：「界面打开」耗时里那段 15~23s 是点击之后才发出的 `import()`
   * （dev 按需编译 / 生产现拉），提前要一遍，用户点开时直接兑现。 */
  useEffect(() => {
    startLazyViewPrefetch();
  }, []);

  /* 同一屏的不同页签共用同一个视图 id，与 `useWorkspaceTabs` 的口径一致。 */
  const openedAtOf = useMemo<ViewOpenedAtLookup>(
    () => (view) => (opened?.view === view ? opened.at : null),
    [opened],
  );

  return (
    <ViewOpenedAtContext.Provider value={openedAtOf}>
      {tabs.map((tab) => {
        const isActive = tab.key === activeKey;
        const isHome = tab.view === "home";
        /* 懒加载视图的「界面打开」日志由 `lazyView` 包的内容自己记（它的测量点
         * 在分块解析后）；即时加载的视图（首页 / 作品库…）在这里补包一层 —— 它
         * 一激活就挂载，耗时天然接近 0，但「打开了」这件事要记下来。 */
        const inner = isLazyView(tab.view) ? (
          renderView(tab)
        ) : (
          <ViewOpenReport view={tab.view}>{renderView(tab)}</ViewOpenReport>
        );
        /* 重视图非活跃降级（ISSUE #4677）：DOM 摘除、状态保留、隐藏期零渲染。 */
        const content = HEAVY_VIEWS.has(tab.view) ? (
          <HeavyViewGate active={isActive}>{inner}</HeavyViewGate>
        ) : (
          inner
        );
        return (
          <div
            aria-hidden={!isActive}
            className={isActive ? "h-full" : "hidden h-full"}
            data-view={tab.view}
            key={tab.key}
          >
            {/* 极光背景：暗色基底上浮动的紫/青/品红发光，给非 home 视图加空间纵深感。
                挂在各自的 wrapper 里（只有非 home 需要）——放在栈外层会让首页也多一层
                随视图切换重挂的装饰层。 */}
            {isHome ? null : <AuroraBackground />}
            {/* 「这一屏是不是当前页」：所有开过的屏都活着、也都会往顶栏的动作槽里
                送按钮，不按页签过滤就会「四屏的按钮挤在同一条顶栏里」（见
                `ViewActions` 里 `ViewTabActiveContext` 那段）。 */}
            <ViewTabActiveProvider active={isActive}>{content}</ViewTabActiveProvider>
          </div>
        );
      })}
    </ViewOpenedAtContext.Provider>
  );
}
