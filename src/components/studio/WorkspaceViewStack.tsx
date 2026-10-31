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
import { useEffect, useMemo, useState, type ComponentType } from "react";

import { reloadOnceForChunkError } from "~/lib/shell/lazy-chunk-recovery";

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
import {
  ViewOpenReport,
  ViewOpenedAtContext,
  withViewOpenReport,
  type ViewOpenedAtLookup,
} from "./ViewOpenReport";
import { registerLazyViewLoader, startLazyViewPrefetch } from "./lazy-view-prefetch";

/**
 * 懒加载视图的**统一出口**：所有 `next/dynamic` 声明都经它，好让「分块加载失败」
 * 有唯一的自愈点（ISSUE #1900）。
 *
 * 为什么要收这一手：这一屏里十二份懒加载声明共用同一件事实 —— 页面首帧拿到的是
 * 「该去哪个分块」的哈希，真正的 `import()` 在点开那一屏时才发出，而 dev server
 * 重建之后那些哈希可能已指向被换掉的旧分块。撞上时整屏崩成「页面出错了」，
 * 用户既不知道要刷新、也不觉得那是环境问题。修法见
 * `~/lib/shell/lazy-chunk-recovery`（判定 + 本会话刷一次）；这里只负责把它接到
 * **每一个** loader 上 —— 漏一个，那一屏就还是崩。
 *
 * 刷新的那一跳返回一个永不 settle 的 promise：页面正在被换掉，让它悬着比
 * 立刻抛错更好（抛了会先闪一下 error boundary 再被导航覆盖）。没触发刷新
 * （不是分块问题 / 本会话已刷过）时照常抛，错误照旧落到 error boundary。
 *
 * 顺带在这条唯一的出口上包一层 `withViewOpenReport`：分块解析后把内容包住，
 * 「界面打开耗时」的测量点于是正好落在内容真正挂载那一刻（外层包裹量不到 ——
 * 见 `./ViewOpenReport` 的说明）。视图 id 一并登记进 `LAZY_VIEWS`，让视图栈
 * 知道「这一屏由懒加载那条路自己记日志」，不必在别处再手抄一份懒加载清单。
 */

/** 由 `lazyView` 自己登记的懒加载视图 —— 它们的「界面打开」日志在内容挂载点写。 */
const LAZY_VIEWS = new Set<WorkspaceView>();

function lazyView<P extends object>(
  view: WorkspaceView,
  loader: () => Promise<ComponentType<P>>,
): ComponentType<P> {
  LAZY_VIEWS.add(view);
  /* 同一份 loader 再登记一份给空闲预热：动态 import 从此不必等用户点开那一屏
   * 才发出（按需编译 / 现拉分块的代价从「点击之后」挪到「挂载之后的空闲里」，
   * 见 ./lazy-view-prefetch）。 */
  registerLazyViewLoader(loader);
  return dynamic(
    () =>
      loader()
        .then((mod) => withViewOpenReport(view, mod))
        .catch((err: unknown) => {
          /* 刷新的那一跳返回一个永不 settle 的 promise：页面正在被换掉，
           * 让它悬着比立刻抛错更好（抛了会先闪一下 error boundary 再被导航覆盖）；
           * 没触发刷新（不是分块问题 / 本会话已刷过）时照常抛，错误照旧落到
           * error boundary。 */
          if (reloadOnceForChunkError(err)) {
            return NEVER_SETTLES;
          }
          throw err;
        }),
    { ssr: false },
  );
}

/** 一个永不 settle 的 promise（见 `lazyView` 里刷新的那一跳）。 */
const NEVER_SETTLES = new Promise<never>(() => {
  /* 故意不给 resolve / reject：页面正在被换掉，这个 promise 不该有任何结算。 */
});

/* ── 懒加载视图组件，好让初始包体保持小 ── */
/* 只有 HomePage / AuroraBackground / VideoQueueModal（在页面侧）是即时加载的。 */
/* 设置（与历史 / 队列 / 控制台同族，都是「项目无关的全局视图」）：只在进入该
 * 视图时才拉 —— 它带着全部配置查询与 Ollama 探测，不该摊到别的视图首屏。 */
const SettingsView = lazyView("settings", () =>
  import("~/components/settings/SettingsView").then((m) => m.SettingsView),
);

/* 模型适配 / 模式契约：与设置同一族（项目无关的全局配置视图）。 */
const ModelAdaptersView = lazyView("model-adapters", () =>
  import("~/components/workshop/ModelAdaptersView").then((mod) => mod.ModelAdaptersView),
);
const ModeContractView = lazyView("mode-contract", () =>
  import("~/components/workshop/mode-contract/ModeContractView").then(
    (mod) => mod.ModeContractView,
  ),
);

/* 资源库：整页素材管理（分类 / 搜索 / 上传 / 删除），与画布那块抽屉同源取数。 */
const ResourceLibrary = lazyView("library", () =>
  import("~/components/studio/library/ResourceLibrary").then((mod) => mod.ResourceLibrary),
);

/* 项目主页：进入项目后的落点。懒加载 —— 它与画布 / 工坊一样只在进项目后需要，
 * 放在应用首页的初始包里没有收益。 */
const ProjectHomePage = lazyView("project", () =>
  import("~/components/studio/project-home").then((mod) => mod.ProjectHomePage),
);

/* 队列与运行：与历史同族（都在看「机器现在在干什么」），只在进入该视图时才拉。 */
const QueueMonitor = lazyView("queue", () =>
  import("~/components/studio/queue/QueueMonitor").then((mod) => mod.QueueMonitor),
);

/* ComfyUI 运行页（ISSUE #1900）：与历史 / 队列同族（「项目无关的全局视图」，
 * 都在看本机后端现在在干什么）。它带着状态查询的事件订阅与启动日志轮询，
 * 懒加载 —— 不该摊到别的视图首屏。 */
const ComfyuiControl = lazyView("comfyui", () =>
  import("~/components/studio/comfyui/ComfyuiControl").then((mod) => mod.ComfyuiControl),
);

/* 控制台（ISSUE #1327）：与历史 / 队列同族（都是「项目无关的全局视图」）。 */
const ConsoleView = lazyView("console", () =>
  import("~/components/console/ConsoleView").then((m) => m.ConsoleView),
);

/* 客户端上懒加载更重的画布 / 影片编辑器（ReactFlow 等）。 */
const FilmStudio = lazyView("film", () =>
  import("~/components/studio/FilmStudio").then((mod) => mod.FilmStudio),
);
const ProjectCanvas = lazyView("canvas", () =>
  import("~/components/studio/ProjectCanvas").then((mod) => mod.ProjectCanvas),
);

/** 页面侧交给视图栈的全部接线 —— 每一屏要用什么都在这里，栈自己不取数。 */
export type WorkspaceViewStackProps = {
  /** 当前页签 key。 */
  activeKey: string;
  /** 活跃项目 id —— 项目类视图与「项目优先闸门」判据。 */
  activeProjectId: string | null;
  /** 当前页签对应的**视图**（同一视图两个页签算同一屏）—— 打开耗时按它归属。 */
  activeView: WorkspaceView;
  /** 画布：开一个新命名项目 / 消费这两枚一次性载荷。 */
  canvasSeedNew: boolean;
  onConsumeCanvasSeed: () => void;
  onConsumePendingWorkflow: () => void;
  onConsumeSettingsSection: () => void;
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
  onShowAllProjects: () => void;
  onUseWorkflow: (id: string, meta?: { name: string; taskType: string }) => void;
  pendingCanvasWorkflow: { id: string; name: string; taskType: string } | null;
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
  onOpenComfyui,
  onUseWorkflow,
  canvasSeedNew,
  onConsumeCanvasSeed,
  pendingCanvasWorkflow,
  onConsumePendingWorkflow,
  settingsSection,
  onConsumeSettingsSection,
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
          onNavigate={onHomeNavigate}
          onNewProject={onNewProject}
          onOpenCanvasProject={onOpenCanvasProject}
          onOpenProject={onOpenProject}
          onShowAllProjects={onShowAllProjects}
          recentProjects={recentProjects}
        />
      );
    }
    // 项目优先闸门：进入项目界面（主页 / 画布 / 工坊 / 资源库 / 产出 / 成片）前必须先有一个活跃项目。
    if (isProjectTab(view) && !activeProjectId) {
      return <ProjectGate onEnter={onEnterProject} onExit={onExitProject} />;
    }
    switch (view) {
      case "project": {
        return (
          <ProjectHomePage
            onNavigate={onNavigate}
            projectId={activeProjectId ?? ""}
            projectName={recentProjects.find((p) => p.id === activeProjectId)?.name ?? "未命名项目"}
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
        return <HistoryList onOpenTask={onOpenProject} />;
      }

      case "queue": {
        return <QueueMonitor onOpenComfyui={onOpenComfyui} />;
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

      case "mode-contract": {
        return <ModeContractView />;
      }

      case "canvas": {
        return (
          <ProjectCanvas
            onConsumePending={onConsumePendingWorkflow}
            onConsumeSeed={onConsumeCanvasSeed}
            pendingWorkflow={pendingCanvasWorkflow}
            seedNew={canvasSeedNew}
          />
        );
      }

      case "film": {
        return <FilmStudio />;
      }

      case "workflows": {
        return <WorkflowLibrary onUse={onUseWorkflow} />;
      }

      case "console": {
        return <ConsoleView />;
      }

      case "outputs": {
        return <ProjectOutputs />;
      }

      case "library": {
        return <ResourceLibrary />;
      }

      case "workshop": {
        return <WorkshopPipeline />;
      }

      default: {
        return null;
      }
    }
  };

  /* 当前屏「打开时刻」的记账 —— 交给 `ViewOpenReport` 在内容挂载点多读一次，
   * 由它算出「内容真的出现」减去这一步的耗时。
   *
   * 为什么是**成对**的 `{ view, at }` 而不是裸时刻：时刻与它对应的视图必须绑在
   * 一起，否则「刚激活、时刻还没换」的那一帧里，新视图会拿到上一屏的旧时刻，算出
   * 一个垃圾耗时（React 的子 effect 先于父 effect —— 内容那侧先读到 provider）。
   * 绑成一对之后该帧读到的是 `null`（视图对不上）⇒ 只记一条正确的。
   *
   * 计时刻意放在 **effect** 里：渲染期调用 `performance.now()` 属 React 的不纯
   * 调用（`react-hooks/purity` 会红），effect 里则是合规的。 */
  const [opened, setOpened] = useState<{
    at: number;
    view: WorkspaceView;
  } | null>(null);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
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
        const content = LAZY_VIEWS.has(tab.view) ? (
          renderView(tab.view)
        ) : (
          <ViewOpenReport view={tab.view}>{renderView(tab.view)}</ViewOpenReport>
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
