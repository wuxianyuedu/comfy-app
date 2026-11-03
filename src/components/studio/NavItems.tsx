"use client";

import React from "react";
import {
  BookOpen,
  Box,
  Cable,
  Film,
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

/**
 * 共享的导航注册表 —— 侧栏 / 顶部标题 / 命令面板 / 项目内切换器的唯一事实来源。
 *
 * 三个分区（一处定义、多处消费，避免漂移）：
 *   · 全局项（`globalNavItems`）—— 主页侧栏顶部常驻，共十件：首页 / 模型 / 历史 /
 *     队列 / ComfyUI / 设置 / 工作流库 / 模型适配 / 模式契约 / 控制台。这十件事都是
 *     **项目无关**的，
 *     走视图页签能开能关 ——
 *     控制台也一样（它跑的是仓库级脚本命令 `pnpm test` / `drizzle-kit`，与「当前是
 *     哪个画布项目」无关，而同形的视图页签让「跑着长命令时切去别处看一眼」成立）；
 *     设置同理：它读写的是应用级配置（模型目录、Ollama、数据库、后端路径），
 *     换项目不该重配一遍；
 *     模型适配 / 模式契约此前是**全局浮层入口**（点开弹窗、不改视图），现在也是全局
 *     视图，排在「工作流库」之后、「控制台」之前 —— 理由与设置、控制台同一批：它们读写的
 *     是全局注册表（模式契约 =
 *     每种模式有哪些统一输入 / 输出；适配器 = 每个远端模型 × 每个模式的字段映射），
 *     与当前项目无关，而弹窗形态没有页签、不能一边配着别的一边对照工作流库；
 *     十件里**侧栏只列九件**（`sidebarNavItems`）—— 设置那一项撤出侧栏（顶栏右上角
 *     的应用菜单本就是它的入口），并标成 `transient`（切走即关）。它的另两个属性
 *     是「全局的」「能在页签条上开」—— 三件事各自独立，见 `NavItem` 的字段说明。
 *   · 项目页签（`projectTabs`）—— 只在「项目界面」顶部的标签栏出现（主页 / 画布 / 工坊 / 资源库 / 产出 / 成片），
 *     不再进主页侧栏：它们是对「当前项目」的操作投影，脱离项目无意义；
 *   · 项目入口（`PROJECTS_ENTRY`）—— 侧栏最底部的「项目」分组（可展开列出已有项目）。
 *
 * 历史教训：此前用 `visibleNavItems(active)` 在「首页 vs 非首页」间切换项目页签的显隐，
 * 导致点「项目」等非首页视图时画布/工坊页签莫名复现、点首页又消失。改成「按分区归属」
 * 一次性决定每项出现在哪个界面，显隐不再随当前视图漂移。
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
  | "model-adapters"
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
   * 不在**侧栏**露面：入口在别处（当前只有「设置」这一项 —— 顶栏右上角的
   * 应用菜单里已有它）。
   *
   * 与 `projectScoped` / `transient` 是三个不同的判断，别合并：`projectScoped`
   * 管「归项目还是归全局」、`transient` 管「切走关不关」、本条只管「侧栏列不列」。
   * 设置三样都沾一点却是三种答案里各挑一个 —— 全局的（不是项目的）、瞬时的
   * （切走就关）、不在侧栏列表里（顶栏已有入口）。
   */
  sidebarHidden?: boolean;
  /**
   * 「瞬时页签」：切走就关，不常驻页签条。
   *
   * 页签存在的意义是**让打开的界面保持打开**（切回来接着用，不重开会丢态）——
   * 那是对画布 / 工坊这类「有编辑态、跑着长任务」的界面说的。而设置 / 模型适配 /
   * 模式契约是一类**读过即走的配置屏**：进来改一项、看一眼、就走，没人指望切走半天
   * 再切回来时草稿还在原地。它们留在页签条上只贡献两件事：占宽、以及「我是不是
   * 又开了个窗口」的错觉。
   *
   * 判据是**语义**不是实现：`transient` 的视图在页签条上照常有自己的一页（就是
   * 当前这一页），也能手动关；只是**切到别处时它自动退场**。见 `workspace-tabs.ts`
   * 的 `withTransientPruned`（那条不变式是「最多只有当前页可以是 transient」）。
   */
  transient?: boolean;
  /**
   * 屏内页头的标题。
   *
   * 「侧栏项 / 页签 /（桌面壳）窗口标题」用 `label` —— 那三处是**导航**，短名才排得下、
   * 也才像导航；屏内页头有整行宽度，写全名更清楚。所以两者本来就该允许不同，
   * 而允许不同的前提是**写在同一行里**：分居两个文件的后果是同一件事长出两个名字，
   * 且没人知道哪个才是当前的（ISSUE #1423 的「队列」/「队列与运行」就是这么来的）。
   *
   * 不填 = 与 `label` 同字。填了就等于说「这一项的全名是这个」，由
   * `pageHeaderTitle()` 统一取值 —— 视图里不再出现裸字面量。
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
    /* ComfyUI（ISSUE #1900）：**出图后端自己的屏** —— 运行状态、启动 / 关闭 /
       打开查看、以及每一次启动的日志。它从「设置 → 创作后端」搬出来独立成页：
       那是改**配置**（装在哪、什么端口）的地方，而这里是**操作与观察**（开起来、
       看它输出什么）的地方。两件事的节奏完全不同 —— 配一次 vs 每次跑图前都要看一
       眼，挤在同一屏上的结果是改路径的人要先等一遍秒级探测、看日志的人要滚过一屏
       输入框。
       归**全局项**而不是项目页签：它管的是本机后端进程，与「当前是哪个画布项目」
       无关；也不需要 `transient` —— 与队列同族（都在看「机器现在在干什么」），
       切走再切回来该保留滚动位置与全屏日志态。 */
    id: "comfyui",
    label: "ComfyUI",
    enabled: true,
    icon: <Server size={22} strokeWidth={1.8} />,
  },
  {
    /* 设置：与历史 / 队列 / 控制台同形的**视图**，不是浮层。
     * 原先它是 workspace 里的一层全屏浮层（`SettingsOverlay`）—— 那层会盖住页签条，
     * 且「当前在设置里」这件事只活在一个布尔值里：既没有页签可关，也不能一边开着
     * 设置一边看别处。改成视图后，入口、高亮、可关性都和别的视图同一套契约。
     * 仍归**全局项**而不是项目页签：它读写的是应用级配置（模型目录、Ollama、
     * 数据库、后端路径），与「当前是哪个画布项目」无关。 */
    id: "settings",
    label: "设置",
    enabled: true,
    transient: true,
    sidebarHidden: true,
    icon: <Settings size={22} strokeWidth={1.8} />,
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
    transient: true,
    icon: <Cable size={22} strokeWidth={1.8} />,
  },
  {
    /* 模式契约：与工作流库页头那枚「模式契约」按钮同图标 —— 同一件事在两处出现时
       认得出是同一件。那枚按钮现在也切到这一页，不再开弹窗。 */
    id: "mode-contract",
    label: "模式契约",
    enabled: true,
    transient: true,
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
 * 侧栏顶部实际渲染的那几项 —— `globalNavItems()` 去掉 `sidebarHidden`。
 *
 * 为什么要与 `globalNavItems()` 分开：那个出口有三个消费者（侧栏列表、页签条的
 * 「+」菜单、命令面板搜索），而用户的诉求只针对**侧栏** —— 设置从侧栏撤掉、
 * 入口归顶栏应用菜单，但它仍应能被「+」菜单和 ⌘K 搜到。收口在 `globalNavItems()`
 * 上会连带把那两处一起删掉（设置就成了只有顶栏一个入口的孤岛）。
 */
export function sidebarNavItems(): Array<NavItem> {
  return globalNavItems().filter((item) => item.sidebarHidden !== true);
}

/** 某视图是不是「瞬时页签」（切走即关，不常驻）—— 规则见 `NavItem.transient`。 */
export function isTransientView(view: WorkspaceView): boolean {
  return NAV_ITEMS.some((item) => item.id === view && item.transient === true);
}

/**
 * 某视图屏内页头的标题 —— 与侧栏 / 页签 / 顶栏标题**同一个出处**。
 *
 * 为什么要有这个出口：屏内页头此前是各视图里的裸字面量（`<h1>历史记录</h1>`），
 * 与 `NAV_ITEMS` 里那一份没有任何判据把它们连起来 —— 于是同一件事长出两个名字
 * 时没有任何东西会红（ISSUE #1423）。视图改成从这里取，名字就只有一处能改。
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
