"use client";

import { subscribeAppEvent } from "~/lib/app-events";
import { useMemo, useState, useCallback, useEffect } from "react";
import { VideoQueueModal, AppShell } from "~/components/studio";
import { WORKSPACE_VIEWS, useWorkspaceTabs } from "~/components/studio/hooks/use-workspace-tabs";
import { useSidebarProjects } from "~/components/studio/hooks/use-sidebar-projects";
import { useOpenServerProject } from "~/components/studio/project-canvas/hooks/use-open-server-project";
import type { RecentProject, WorkspaceView } from "~/components/studio";
import { WorkspaceViewStack } from "~/components/studio/WorkspaceViewStack";
import { globalNavItems, projectTabs } from "~/components/studio/NavItems";
import { ShellTabs } from "~/components/studio/ShellTabs";
import { timeAgo } from "~/lib/time-format";
import {
  deleteProjectEverywhere,
  getActiveId,
  getProject,
  listProjects,
  reapAllEmptyDrafts,
  type CanvasProject,
} from "~/lib/project-canvas/canvas-store";
import { CreateProjectDialog } from "~/components/studio/CreateProjectDialog";

/* 近期项目列表按**展示字段**逐项比较（ISSUE #4600）：全部相同就复用旧数组引用，
 * 掐掉「编辑期每 500ms 一拍广播 → recentProjects 换引用 → 整壳重渲染」那条税。 */
function sameRecentProjects(prev: Array<RecentProject>, next: Array<RecentProject>): boolean {
  if (prev.length !== next.length) {
    return false;
  }
  return prev.every((item, index) => {
    const candidate = next[index];
    return (
      candidate !== undefined &&
      item.id === candidate.id &&
      item.name === candidate.name &&
      item.updatedAt === candidate.updatedAt &&
      item.subtitle === candidate.subtitle &&
      item.kind === candidate.kind
    );
  });
}

/* ── 工作区页面 —— Updream 风全屏编辑器 ── */

export default function WorkspacePage() {
  // ── Layout state ──
  /* 页签状态、恢复/落盘、打开/选中/关闭都在 `useWorkspaceTabs`（§12.13：组件已经
     在函数长度阈值附近，按职责拆而不是在里面加注释分段）。 */
  const {
    tabs: viewTabs,
    activeKey: activeViewKey,
    viewMode,
    navigateTo,
    closeProjectTabs,
    selectTab: selectViewTab,
    closeTab: closeViewTabByKey,
  } = useWorkspaceTabs();

  /* 「请求切到某个视图」应用事件的唯一订阅侧（触发方是工坊右栏「资源库」卡，链路隔
   * WorkshopPipeline/WorkshopAside 两层，穿 props 不划算）。载荷按 `WORKSPACE_VIEWS` 收敛，
   * 未知 id 忽略；`section` 先落一次性 state，由设置视图消费后回调清空。 */
  const [pendingSettingsSection, setPendingSettingsSection] = useState<string | null>(null);
  const consumeSettingsSection = useCallback(() => {
    setPendingSettingsSection(null);
  }, []);
  useEffect(
    () =>
      subscribeAppEvent("workspace:navigate", ({ view, section }) => {
        const target = WORKSPACE_VIEWS.find((candidate) => candidate === view);
        if (!target) {
          return;
        }
        if (target === "settings" && section !== undefined && section !== "") {
          setPendingSettingsSection(section);
        }
        navigateTo(target);
      }),
    [navigateTo],
  );

  // ── 视频队列弹窗 ──
  const [videoQueueOpen, setVideoQueueOpen] = useState(false);

  // ── 设置：一个视图，不是一个浮层 ──
  // 「去设置」的几处入口（侧栏、顶栏菜单、队列、首页算力卡）都切到 settings 视图。
  // 原先是 workspace 内的一层全屏浮层：它会盖住页签条，且「当前在设置里」这件事
  // 只存在于一个布尔值里 —— 既没有页签，也不能同时开着别处。
  const openSettings = useCallback(() => {
    navigateTo("settings");
  }, [navigateTo]);
  /* 队列屏离线时的出口：送到侧栏「ComfyUI」页（启动 / 关闭与运行状态都在那里，
   * ISSUE #1900）—— 不再送设置页，那一页只管路径。 */
  const openComfyui = useCallback(() => {
    navigateTo("comfyui");
  }, [navigateTo]);

  // ── 当前活跃项目 id（项目闸门的判据）：来源 canvas-store 的 active 键，
  //    只在客户端可读，SSR 首帧为 null。订阅 store 变化事件保持同步。
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const refreshActiveProject = useCallback(() => {
    setActiveProjectId(getActiveId());
  }, []);
  useEffect(() => {
    // 首帧后同步一次活跃项目 id（getActiveId 只在客户端可读，SSR 为 null）；
    // 与本文件恢复视图处同一约定。订阅回调里的 setState 属合规的外部同步。
    // oxlint-disable-next-line react/set-state-in-effect
    refreshActiveProject();
    /* 自动保存（save）不动 active-id，跳过（ISSUE #4600）：编辑期每 500ms
     * 一拍都来重设同一个值只会白打重渲染。 */
    return subscribeAppEvent("comfyapp:canvas-store-changed", (payload) => {
      if (payload.reason !== "save") {
        refreshActiveProject();
      }
    });
  }, [refreshActiveProject]);

  // ── 设置后，无限画布接收这条工作流并为它放一个
  //    `kind="workflow"` 节点（来自工作流库的「使用」动作）。
  const [pendingCanvasWorkflow, setPendingCanvasWorkflow] = useState<{
    id: string;
    name: string;
    taskType: string;
  } | null>(null);

  // ── 新建项目：先弹命名对话框，确认后再创建（ISSUE #4765）。
  //    统一入口（侧栏「+新建」、首页卡片、作品库「新建创作」、ProjectGate）都落到这里。
  const [createProjectOpen, setCreateProjectOpen] = useState(false);
  const handleProjectCreated = useCallback(
    (_project: CanvasProject) => {
      // 创建成功即收起对话框（否则连点会连建多个项目），再刷新读数落到项目主页。
      setCreateProjectOpen(false);
      // createProject 内部已设为活跃；这里刷新读数并落到项目主页。
      refreshActiveProject();
      navigateTo("project");
    },
    [navigateTo, refreshActiveProject],
  );

  // 最近项目来源是 canvas-store（localStorage），不是 Task 表（Task.type 不含画布项目类型）。
  // 挂载时 + store 变化时加载：存 localStorage 故 SSR 返回 []，挂载后再水合；
  // "comfyapp:canvas-store-changed" 事件让首页与 ProjectCanvas 的编辑保持同步，无需整页重载。
  const [recentProjects, setRecentProjects] = useState<Array<RecentProject>>([]);
  useEffect(() => {
    // 在首页挂载时做一次性清扫：移除较早代码版本
    // 留在索引里的陈旧空默认名草稿。
    // 若真清掉了东西就触发 `comfyapp:canvas-store-changed`，好让
    // 下面的刷新回调重读 `listProjects()`，首页最近项目列表
    // 无需硬重载就保持干净。
    reapAllEmptyDrafts();
    const compute = () => {
      const next = listProjects()
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
            /* SAFETY: 类型断言已复核 */
            kind: "canvas" as const,
            subtitle: nodeCount > 0 ? `${nodeCount} 节点 · ${edgeCount} 连线` : "空画布",
            thumbnails: [],
          };
        });
      /* 内容没变就复用旧数组引用（ISSUE #4600）：自动保存每 500ms 一拍都会
       * 广播到这里，而 recentProjects 穿进 WorkspaceViewStack / projectNameOf
       * —— 引用一换整壳跟着重渲染。展示字段（id/名/时间文案/副标题）全部
       * 相同就保持旧引用，把「编辑期整壳重渲染」掐掉。 */
      setRecentProjects((prev) => (sameRecentProjects(prev, next) ? prev : next));
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

  /* 侧栏里点开某个项目那一跳 —— 「服务端有、本机还没有副本」的行要先拉回本机，
   * 否则落点是闸门（ISSUE #1874，见 `useOpenServerProject`）。首页最近项目、
   * 「所有项目」屏与侧栏的打开动作现在都走这一条（先水合、再设活跃 + 落主页），
   * 三处同一支 —— 只看本地索引的旧路径会在服务端独有行上落空。 */
  const handleOpenServerProject = useOpenServerProject(navigateTo);

  const handleNewProject = useCallback(() => {
    // 统一「新建项目」入口：先弹命名对话框，**确认后再创建**（ISSUE #4765）。
    // 不再直接 createProject() 产生「未命名_N」行，也不再留本地草稿项目。
    setCreateProjectOpen(true);
  }, []);

  /* 打开一个项目 —— 先把服务端那一行水合到本机，再设为活跃并落到**项目主页**。
   *
   * 此前落画布，于是「一进项目就是一张无限画布」，用户看不到这个项目做到哪了
   *（画布只表达节点图，不表达阶段 / 素材 / 成片）。主页是项目级视图的入口，
   * 想去画布再从左列表切一步。 */
  const handleOpenCanvasProject = useCallback(
    (id: string) => {
      void handleOpenServerProject(id);
    },
    [handleOpenServerProject],
  );

  const handleHomeNavigate = useCallback(
    (view: WorkspaceView) => {
      // 接受任何已注册的 WorkspaceView id；"home" 就是当前视图，
      // 所以再点它是个空操作。
      if (view === "home") {
        return;
      }
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
        // 统一新建项目：先弹命名对话框，确认后再创建（与 handleNewProject 同一口）。
        setCreateProjectOpen(true);
      } else {
        // 打开一个真实项目：先水合服务端行，再设活跃 + 落**项目主页**（与
        // handleOpenCanvasProject 同一在役落点）。曾经的「作品详情页（溯源 +
        // 执行日志）」是独立路由 /create/[id]，该路由已退役（#2422）——
        // 项目自身的在役入口就是项目主页。
        void handleOpenServerProject(id);
      }
    },
    [handleOpenServerProject],
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

  /**
   * 「+」菜单里能开的视图：入口兜底——侧栏刻意不列项目内六视图，ProjectTabBar 退役后没有
   * 这里它们就 unreachable。项目类视图只在已有活跃项目时放出（没有项目点了也只会落到
   * ProjectGate）。
   */
  /** 项目 id → 项目名（页签标题用「工坊·项目名」区分同一视图的多页）。 */
  const projectNameOf = useCallback(
    (projectId: string | null) =>
      projectId !== null && projectId !== ""
        ? (recentProjects.find((project) => project.id === projectId)?.name ?? null)
        : null,
    [recentProjects],
  );

  /* 侧栏「项目」分组列出的项目 —— 与「所有项目」那一屏同一支取数（并集，
   * 见 `useSidebarProjects`）。此前这里直接用 `recentProjects`，而它读的是
   * 本地索引：画布页没打开过就没有 `hydrateFromServer` 那次对账，于是
   * 「服务端有一行、索引里没有」的项目在侧栏**一条都不列**（ISSUE #1874）。 */
  const sidebarProjects = useSidebarProjects();

  /* 删除项目（项目页内左列表底部的危险入口）：本地 + 服务端一并删，并关掉
   * 该项目名下的页签 —— 当前页被关则按规则落回首页（ISSUE #4765）。 */
  const handleDeleteProject = useCallback(
    (id: string) => {
      deleteProjectEverywhere(id, getProject(id)?.name);
      closeProjectTabs(id);
      refreshActiveProject();
    },
    [closeProjectTabs, refreshActiveProject],
  );

  const openableViews = useMemo(
    () => [
      ...globalNavItems().map((item) => ({ view: item.id, label: item.label })),
      /* 一项目一页签（ISSUE #4765）：「+」菜单里项目只列「主页」这一页；
       * 画布 / 工坊 / 资源库 / 产出 / 成片改为项目页内左列表分区，不再各自成页。 */
      ...(activeProjectId !== null && activeProjectId !== ""
        ? projectTabs()
            .filter((item) => item.id === "project")
            .map((item) => ({ view: item.id, label: item.label }))
        : []),
    ],
    [activeProjectId],
  );

  return (
    /* ShellTabs 只管「标题行 chrome + iframe 页签内容」：页签切换器已在侧栏
       「临时页签」组（ISSUE #4770），视图页签的读数与动作都由 AppShell 接。 */
    <ShellTabs>
      <>
        {/* 日志/Toast Provider 与底部状态栏已全局挂载（根布局），此处不再重复包裹 */}
        {/* 侧栏 + 顶栏 + 主内容容器都归 `AppShell`（规范 §12.1 规划的壳层）。
            home 与其余视图共用同一套导航与工具条 —— 此前是「首页自带内联侧栏与
            顶栏 / 其余视图用 64px 自绘竖排导航条」两套形态，属历史遗留。 */}
        <AppShell
          active={viewMode}
          activeProjectId={activeProjectId}
          activeViewKey={activeViewKey}
          onCloseViewTab={closeViewTabByKey}
          onNewProject={handleNewProject}
          onOpenProject={handleOpenServerProject}
          onOpenSettings={openSettings}
          onOpenView={navigateTo}
          onSelect={handleNavSelect}
          onSelectViewTab={selectViewTab}
          onShowAllProjects={handleShowAllProjects}
          openableViews={openableViews}
          projectNameOf={projectNameOf}
          projects={sidebarProjects}
          viewTabs={viewTabs}
        >
          {/* 常驻视图栈：打开的每一页都**保持挂载**，用 CSS 显隐切换 ——
              这就是页签的意义（切走不卸载、切回不重开）。实现在
              `WorkspaceViewStack`（那里有懒加载声明与逐屏渲染分支）。 */}
          <WorkspaceViewStack
            activeKey={activeViewKey}
            activeView={viewMode}
            onConsumePendingWorkflow={() => {
              setPendingCanvasWorkflow(null);
            }}
            onConsumeSettingsSection={consumeSettingsSection}
            onDeleteProject={handleDeleteProject}
            onEnterProject={refreshActiveProject}
            onExitProject={() => {
              navigateTo("home");
            }}
            onHomeNavigate={handleHomeNavigate}
            onNavigate={handleNavSelect}
            onNewProject={handleNewProject}
            onOpenCanvasProject={handleOpenCanvasProject}
            onOpenComfyui={openComfyui}
            onOpenProject={handleOpenProject}
            onShowAllProjects={handleShowAllProjects}
            onUseWorkflow={handleUseWorkflow}
            pendingCanvasWorkflow={pendingCanvasWorkflow}
            recentProjects={recentProjects}
            settingsSection={pendingSettingsSection}
            tabs={viewTabs}
          />
        </AppShell>

        {/* 视频队列弹窗：两个视图分支此前各挂一份同构实例，合并为一处。 */}
        <VideoQueueModal
          onClose={() => {
            setVideoQueueOpen(false);
          }}
          onOpenTask={() => {
            setVideoQueueOpen(false);
            // 任务详情弹层（HistoryDetailModal）挂在历史视图里 —— 在视频队列
            // 重开入口之前，详情入口以历史视图为准（曾经的独立路由 /create/[id]
            // 已退役，#2422）。这里不直接开弹层：队列弹窗目前没有打开者，
            // 为不可达回调接整套详情取数不划算，切到历史视图就是等价在役入口。
            navigateTo("history");
          }}
          open={videoQueueOpen}
        />

        {/* 新建项目：先命名、确认后再创建（ISSUE #4765）。
            条件挂载：每次打开都是一次全新挂载，名称从空开始（不靠 effect 复位）。 */}
        {createProjectOpen ? (
          <CreateProjectDialog
            onClose={() => {
              setCreateProjectOpen(false);
            }}
            onCreated={handleProjectCreated}
            open
          />
        ) : null}
      </>
    </ShellTabs>
  );
}
