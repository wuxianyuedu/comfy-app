"use client";

import React from "react";
import {
  Blocks,
  BookOpen,
  Box,
  Cable,
  Film,
  FlaskConical,
  Folder,
  FolderOpen,
  History,
  Home,
  Image as ImageIcon,
  ListChecks,
  Puzzle,
  Server,
  Settings,
  Terminal,
} from "lucide-react";

import {
  projectSidebarTabConfig,
  sidebarTabModeOf,
  type SidebarTabConfig,
} from "~/lib/shell/sidebar-tab-behavior";

/**
 * 共享的导航注册表 —— 侧栏 / 顶部标题 / 命令面板 / 项目内切换器的唯一事实来源。三个分区：全局项（`globalNavItems`，十二件项目无关的事；控制台跑仓库级脚本、设置读写应用级配置、模型适配/测试模型/模式契约读写全局配置、UI 控件总览是开发者的基元对照页，故都该能开能关）；项目页签（`projectTabs`，只在项目界面顶部的标签栏出现，脱离项目无意义）；项目入口（`PROJECTS_ENTRY`，侧栏底部「项目」分组）。
 * 全局项共十二件，但侧栏只列十件（`sidebarNavItems`）：设置与 UI 控件总览撤出侧栏（设置的入口在顶栏应用菜单、控件总览的入口在命令面板）。「全局的 / 侧栏列不列」是两个独立属性；而「切走关不关」不再写在注册表里 —— 每个全局视图（首页除外）都在「设置 → 界面页签」的配置面里逐项配，见 `configurableTabViews` 与 `~/lib/shell/sidebar-tab-behavior`（ISSUE #3798）。
 * 历史教训：此前用 `visibleNavItems(active)` 按「首页 vs 非首页」切换项目页签显隐，导致点非首页视图时画布/工坊复现、点首页又消失；现改为「按分区归属」一次性决定，显隐不随当前视图漂移。
 */
export type WorkspaceView =
  | "home"
  | "project"
  | "canvas"
  | "models"
  | "works"
  | "workshop"
  | "library"
  | "history"
  | "queue"
  | "comfyui"
  | "film"
  | "workflows"
  | "outputs"
  | "console"
  | "settings"
  | "uiKit"
  | "model-adapters"
  | "model-test"
  | "mode-contract";

export type NavItem = {
  /** 这个视图的工作是否已上线（驱动 cursor / opacity） */
  enabled?: boolean;
  icon: React.ReactNode;
  id: WorkspaceView;
  label: string;
  /**
   * 属于「项目页签」：只在项目界面顶部的标签栏出现，不进主页侧栏顶部列表。
   * 主页 / 画布 / 工坊 / 资源库 / 产出 / 成片是对「当前项目」的操作投影。
   */
  projectScoped?: boolean;
  /**
   * 不在**侧栏**露面：入口在别处（当前只有「设置」与「UI 控件总览」—— 前者在顶栏
   * 应用菜单、后者在命令面板 / 「+」菜单）。与 `projectScoped` 是两条不同的判断，
   * 别合并：那条管「归项目还是归全局」，本条只管「侧栏列不列」。
   *
   * 「切走关不关」不在这里写：它归设置里的配置面管（ISSUE #3798），见
   * `configurableTabViews`。非侧栏的界面与侧栏项同走一份配置，入口不同不改变
   * 这件事 —— 否则「设置里配了、界面却不认」就是两处各说各话。
   */
  sidebarHidden?: boolean;
  /**
   * 屏内页头的标题。「侧栏项 / 页签 /（桌面壳）窗口标题」用 `label`（短名才像导航），屏内页头有整行宽度、写全名更清楚；两者允许不同，前提是写在同一行里 —— 分居两文件会长出两个名字且没人知道哪个是当前的（ISSUE #1423 的「队列」/「队列与运行」）。
   * 不填 = 与 `label` 同字；填了由 `pageHeaderTitle()` 统一取值，视图里不再出现裸字面量。
   */
  viewLabel?: string;
};

/** 侧栏项统一使用的图标描边 + 尺寸。 */
const ICON_PROPS = {
  width: 22,
  height: 22,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  /* SAFETY: 类型断言已复核 */
  strokeLinecap: "round" as const,
  /* SAFETY: 类型断言已复核 */
  strokeLinejoin: "round" as const,
};

/** 侧栏底部「项目」分组入口（不作为顶部项，也不作为项目页签）。 */
export const PROJECTS_ENTRY: NavItem = {
  id: "works",
  label: "项目",
  enabled: true,
  icon: <Folder size={22} strokeWidth={1.8} />,
};

/**
 * 全量注册表：顶部标题（`TopBar`）按 id 反查标签、命令面板取全局项 + 项目页签都读它。
 * 顺序 = 全局项在前、项目页签居中、项目入口（works）在后；分区由下方 helper 按标记切出。
 */
export const NAV_ITEMS: Array<NavItem> = [
  {
    id: "home",
    label: "首页",
    icon: <Home size={22} strokeWidth={1.8} />,
  },
  {
    id: "models",
    label: "模型",
    icon: <Box size={22} strokeWidth={1.8} />,
  },
  {
    id: "history",
    label: "历史",
    enabled: true,
    icon: <History size={22} strokeWidth={1.8} />,
  },
  {
    id: "queue",
    label: "队列",
    /* 原先页头写「队列与运行」。它与侧栏 / 页签的「队列」指的是同一件事，
     * 两个名字只让标题区多占一行（ISSUE #1423）。现在与 `label` 同字 —— 这一条
     * 就是「一屏只留一个名字」在代码里的落点，由 `viewLabel` 缺省来保证。 */
    enabled: true,
    icon: <ListChecks size={22} strokeWidth={1.8} />,
  },
  {
    /* ComfyUI（ISSUE #1900）：**出图后端自己的屏** —— 运行状态、启动/关闭、打开查看、每次启动的日志。它从「设置 → 创作后端」搬出来独立成页：那边改**配置**（装在哪、什么端口），这边是**操作与观察**（配一次 vs 每次跑图前都要看一眼）。
       归**全局项**而不是项目页签：它管本机后端进程，与当前画布项目无关；也不需要切走即关 —— 与队列同族，切走再回来该保留滚动位置与全屏日志态。 */
    id: "comfyui",
    label: "ComfyUI",
    enabled: true,
    icon: <Server size={22} strokeWidth={1.8} />,
  },
  {
    /* 设置：与历史 / 队列 / 控制台同形的**视图**，不是浮层。原先的全屏浮层（`SettingsOverlay`）会盖住页签条，「当前在设置里」只活在一个布尔值里：没有页签可关，也不能一边开着设置一边看别处。
     * 改成视图后入口、高亮、可关性与别的视图同一套契约。仍归**全局项**而非项目页签：它读写应用级配置（模型目录、Ollama、数据库、后端路径），与当前项目无关。
     * 切走关不关由配置面决定（ISSUE #3798），出厂是「共享标签页」（读过即走）。 */
    id: "settings",
    label: "设置",
    enabled: true,
    sidebarHidden: true,
    icon: <Settings size={22} strokeWidth={1.8} />,
  },
  {
    /* UI 控件总览（ISSUE #3525/#3726/#3798）：开发者的基元对照页。原先走独立路由
       `/ui-kit` 整窗跳转，会把工作区的页签条与关闭按钮整个盖住（ISSUE #3726）
       —— 改成**视图页签**：命令面板 /「+」菜单里打开，页签条留在原地。
       与设置同族：全局项、不进侧栏；但切走**不关**（#3798 的期望）—— 对照基元
       时要来回切主题 / 切别处看效果，出厂默认「独立标签页」，同样可在设置里改。 */
    id: "uiKit",
    label: "UI 控件总览",
    enabled: true,
    sidebarHidden: true,
    icon: <Blocks size={22} strokeWidth={1.8} />,
  },
  {
    /* 名字从「流程」改成「工作流库」（ISSUE #1847）：主页那张功能卡一直写的是
       「工作流库」，而导航这一项却写「流程」—— 同一件事两个名字，用户点进去还要
       再认一次。主页卡的用词才是它真正的名字，这里对齐它。 */
    id: "workflows",
    label: "工作流库",
    enabled: true,
    icon: (
      <svg {...ICON_PROPS}>
        <rect height="7" rx="1.5" width="7" x="3" y="3" />
        <rect height="7" rx="1.5" width="7" x="14" y="14" />
        <path d="M10 6.5h4a3 3 0 013 3v4.5" />
      </svg>
    ),
  },
  {
    /* 模型适配：与「工作流库」相邻而不是与「模型」相邻 —— 契约口清单是工作流库配落点的
       依据、适配器是远端模型的字段映射，两件事都服务工作流这条链路。图标仍与「模型」
       那项（`Box`）刻意不同：一个管模型库本身，一个管远端接口的字段映射。
       它此前是侧栏的「全局浮层入口」（点开弹窗、不改视图），现在是视图页签。 */
    id: "model-adapters",
    label: "模型适配",
    enabled: true,
    icon: <Cable size={22} strokeWidth={1.8} />,
  },
  {
    /* 测试模型能力（#3590）：紧跟「模型适配」—— 这页消费的正是适配器配出来的
       工坊同款输入 / 输出。放全局项（与模型适配同族）：它测的是「配置层」的模型
       能力，与「当前是哪个画布项目」无关。 */
    id: "model-test",
    label: "测试模型",
    enabled: true,
    icon: <FlaskConical size={22} strokeWidth={1.8} />,
  },
  {
    /* 模式契约：与工作流库页头那枚「模式契约」按钮同图标 —— 同一件事在两处出现时
       认得出是同一件。那枚按钮现在也切到这一页，不再开弹窗。 */
    id: "mode-contract",
    label: "模式契约",
    enabled: true,
    icon: <Puzzle size={22} strokeWidth={1.8} />,
  },
  {
    /* 控制台（ISSUE #1327）：跑质量门禁 / db:push / git 查询这类「本来要另开一个
     * 终端窗口」的操作。它是**视图**（与历史 / 队列同形，页签能开能关），不是浮层 ——
     * 跑一条 `pnpm test` 是分钟级的事，用户在等待时还要能切去画布看一眼、回来接着看输出；
     * 弹窗一关就断连回收命令，那正是「不敢长时间跑」的来源。
     * 仍放**全局项**而不是项目页签：它跑的是仓库级脚本，与「当前是哪个画布项目」无关。 */
    id: "console",
    label: "控制台",
    enabled: true,
    icon: <Terminal size={22} strokeWidth={1.8} />,
  },
  {
    /* 项目主页放在页签第一位：它是进入项目后的落点（此前直接落画布，
     * 而画布承载不了「这个项目做到哪了」这类项目级问题）。图标用 `Home`
     * 与全局「首页」同形 —— 两个 home 语义层级不同（应用级 / 项目级），
     * 靠所在分组区分，换一个陌生图标反而更难认。 */
    id: "project",
    label: "主页",
    enabled: true,
    projectScoped: true,
    icon: <Home size={22} strokeWidth={1.8} />,
  },
  {
    id: "canvas",
    label: "画布",
    enabled: true,
    projectScoped: true,
    icon: (
      <svg {...ICON_PROPS}>
        <rect height="18" rx="2" width="18" x="3" y="3" />
        <path d="M3 9h18M9 21V9" />
        <circle cx="15" cy="15" r="2" />
      </svg>
    ),
  },
  {
    id: "workshop",
    label: "工坊",
    projectScoped: true,
    icon: <BookOpen size={22} strokeWidth={1.8} />,
  },
  {
    id: "library",
    label: "资源库",
    projectScoped: true,
    icon: <FolderOpen size={22} strokeWidth={1.8} />,
  },
  {
    id: "outputs",
    label: "产出",
    enabled: true,
    projectScoped: true,
    icon: <ImageIcon size={22} strokeWidth={1.8} />,
  },
  {
    id: "film",
    label: "成片",
    projectScoped: true,
    icon: <Film size={22} strokeWidth={1.8} />,
  },
  PROJECTS_ENTRY,
];

/** 主页侧栏顶部常驻的全局项（排除项目页签与项目入口）。 */
export function globalNavItems(): Array<NavItem> {
  return NAV_ITEMS.filter((item) => item.projectScoped !== true && item.id !== PROJECTS_ENTRY.id);
}

/**
 * 侧栏顶部实际渲染的那几项 —— `globalNavItems()` 去掉 `sidebarHidden`。为何分开：那个出口有三个消费者（侧栏、页签条「+」菜单、命令面板），诉求只针对侧栏 —— 设置在「+」菜单与 ⌘K 里仍要能搜到，收口到 `globalNavItems()` 会把它变成只有顶栏一个入口的孤岛。
 */
export function sidebarNavItems(): Array<NavItem> {
  return globalNavItems().filter((item) => item.sidebarHidden !== true);
}

/** 首页视图 id —— 固定页签，恒在、不可关（`workspace-tabs.ts` 的 `HOME_VIEW` 同值）。 */
const FIXED_HOME_VIEW: WorkspaceView = "home";

/**
 * **配置面内**的全局视图（可配「独立标签页 / 共享标签页」的那些界面，ISSUE #3623 / #3798）。
 *
 * 取 `globalNavItems()` 而不是 `sidebarNavItems()`：设置与 UI 控件总览虽不在侧栏
 * 露面，但同样是常驻工作区的界面，用户想配「切走关不关」的诉求对它们一样成立
 * （ISSUE #3798）。此前落在侧栏那份清单上，于是这两屏在设置里根本看不见、也没法
 * 改 —— 「入口在别处」和「行为能不能配」是两件事，别混为一谈。
 *
 * 首页不在其中：它是**固定页签**（恒在、不可关），「切走即关」对它没有意义 ——
 * 真按它那样做，「首页永远在列表里」这条不变式就得靠另一条规则兜着，而那条规则
 * 本身没有任何用户可见的收益。
 */
export function configurableTabViews(): Array<NavItem> {
  return globalNavItems().filter((item) => item.id !== FIXED_HOME_VIEW);
}

/**
 * 某视图是不是「瞬时页签」（切走即关，不常驻）—— **只认配置面**（ISSUE #3798）。
 *
 * 此前是两层判据：配置优先，缺项时回落到注册表里写死的 `transient` 标记。那层兜底
 * 正是非侧栏界面「设置里配了、界面却不认」的来源：设置与控件总览没有配置条目，
 * 永远走注册表；把标记删掉又会让配置缺项时行为漂移。现在配置是**唯一事实来源**，
 * `sidebar-tab-defaults.json` 为每个全局视图（首页除外）都给了档位，缺项即
 * 「不瞬时」（独立标签页），代码里不再藏第二份意见。
 *
 * `config` 传的是**生效配置**（项目默认 + 本机覆盖）；服务端那份还没取回时，
 * 调用方传项目默认（编译进产物的那份），于是「配置还没到」与「配置就是默认」
 * 两件事在界面上长得一样 —— 那正是它们该有的样子（默认值本来就是用户看到的第一眼）。
 */
export function isTransientView(view: WorkspaceView, config: SidebarTabConfig): boolean {
  return sidebarTabModeOf(view, config) === "shared";
}

/**
 * 「这一项是不是瞬时页签」的判据 —— 由调用方注入。
 *
 * 为什么是参数而不是常量：配置化之后（ISSUE #3623）这个判据**因配置而异**，
 * 纯函数层不该自己去读配置（那是 IO 面的事）。页签规则（`workspace-tabs.ts`）
 * 只管「按判据行动」，判据由装配层给。
 */
export type TransientJudge = (view: WorkspaceView) => boolean;

/** 按生效配置造一个判据（配置面是唯一事实来源，ISSUE #3798）。 */
export function makeTransientJudge(config: SidebarTabConfig): TransientJudge {
  return (view) => isTransientView(view, config);
}

/**
 * 项目默认那份配置（编译进产物的那份）—— 「配置还没从服务端取回」时的兜底。
 *
 * 单独导出而不是让调用方各自 import JSON：项目默认的**形状**（哪些项、各是什么档）
 * 只有这一份判据，调用方自己读 JSON 就会各自解析、各自兜底（§12.18）。
 */
export function defaultSidebarTabConfig(): SidebarTabConfig {
  return projectSidebarTabConfig();
}

/**
 * 某视图屏内页头的标题 —— 与侧栏 / 页签 / 顶栏标题**同一个出处**。此前页头是各视图里的裸字面量（`<h1>历史记录</h1>`），与 `NAV_ITEMS` 没有判据相连，同一件事长出两个名字时没东西会红（ISSUE #1423）；视图改从这里取，名字只有一处能改。
 */
export function pageHeaderTitle(view: WorkspaceView): string {
  const item = NAV_ITEMS.find((it) => it.id === view);
  return item?.viewLabel ?? item?.label ?? view;
}

/** 项目界面顶部的切换页签（主页 / 画布 / 工坊 / 资源库 / 产出 / 成片）。 */
export function projectTabs(): Array<NavItem> {
  return NAV_ITEMS.filter((item) => item.projectScoped === true);
}

/** 某视图是否属于项目页签（决定要不要渲染项目内顶部标签栏）。 */
export function isProjectTab(view: WorkspaceView): boolean {
  return projectTabs().some((item) => item.id === view);
}
