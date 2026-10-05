import { useEffect, useState, type ReactNode } from "react";

import { AppShell } from "~/components/studio/AppShell";
import { WorksGallery } from "~/components/studio/WorksGallery";
import {
  DocumentFrame,
  WorkspaceFrame,
} from "~/components/studio/ViewContainer";
import {
  createProject,
  deleteProject,
  listProjects,
  setActive,
  upsertProject,
  type CanvasProject,
} from "~/lib/project-canvas/canvas-store";

/**
 * 「整屏容器 → story」注入层（ISSUE #1381 的第三批：三层注入之三）。
 *
 * ## 它解决什么
 *
 * `AppShell` / `ProjectCanvas` / `WorkshopPipeline` 这一族是**整屏容器**：它们的
 * 「形态」不是某一块 UI，而是「把十几个子件拼成一屏」。给它们写 story 一直卡在
 * 同一处有两半：
 *
 * 1. **壳里得有真内容**。摆一个 `<div>内容</div>` 的假子件，画布上看的是「外壳
 *    围着一块占位符」，那证明不了任何事 —— 所以这一层给的是**真视图**
 *    （`WorksGallery` 那种真读 canvas-store 的屏），不是占位 div；
 * 2. **画布容器得有真项目**。`ProjectCanvas` 从 `canvas-store` 读当前活跃项目，
 *    没有项目时它落在一张叫「未命名」的空画布上 —— 那是真形态，但不是这一族
 *    要看的东西（要看的是「有项目时外壳长什么样」）。所以这一层负责**用真
 *    action 建一个项目**（`createProject()` + `upsertProject()`），与用户点
 *    「新建项目」走的是同一条路。
 *
 * ## 三条口径
 *
 * 1. **子件必须是真的**：这一层不提供「占位内容」这种档位。要摆一屏，就把真视图
 *    摆进去 —— 与 §16.2.3.6 的「不给数据依赖型组件 mock 假形态」同源，只是对象从
 *    「组件」换成了「一屏」。
 * 2. **项目走真 action**：`createProject()` 会自己找不撞名的名字、写索引、置活跃。
 *    在 story 里手拼一个 `CanvasProject` 字面量会跳过这套规则（撞名 / 未置活跃），
 *    而那正是真机上「打开项目看到空白」的常见根因。
 * 3. **一份 story 一份项目的隔离靠名字**：storybook 的 `localStorage` 在同一份
 *    origin 下是共享的，所以这里给的项目名带 story 标识、并在挂载前把同名旧项目
 *    删掉 —— 否则刷新两次之后侧栏里会叠出五个同名项目。
 *
 * ## 这一层会打出「打到工作台自己身上」的请求，且它是刻意留着的
 *
 * 整屏容器这一族里有一半会发请求，而它们的**客户端不止一个**：
 *
 *  · `~/trpc/react`（React hook）走 `preview.tsx` 包的 provider，origin 是工具栏
 *    那个**真应用**地址 —— 应用没起时现场是 `ERR_CONNECTION_REFUSED`；
 *  · `~/trpc/vanilla`（`canvas-store` 的持久化）与几处裸 `fetch`（`/api/production`、
 *    `/api/workshop/draft`）按 `getBaseUrl()` / 相对路径取 origin，**即工作台自己**
 *    —— 现场是一个 404。`getBaseUrl()` 在浏览器里是 `window.location.origin`，
 *    没有可注入的入口，所以这类请求**绕不开**（改它就得动生产代码，而那是为开发
 *    工具改生产面）。
 *
 * 两处都**不假装正常**：`canvas-store` 的镜像失败走的是 `reportMirrorFailure` /
 * `logSyncIssue`（提醒，不是功能失败，本地项目照常可用），画布与工坊那几处拉取
 * 失败都静默落到**降级形态**（空态 / 骨架在）—— 与 `data-sources.tsx` 里那条
 * 「连不上画真的连不上」同一条口径。
 *
 * 所以看到一个打到工作台的 404 不是这一层坏了；**不要**为了让它安静下来去给
 * 工作台加一层 mock（那正是这一批在防的事）。
 */
/** 一个真项目：名字与节点数据都是真形状（节点类型用 `canvas-types` 的真 kind）。 */
export interface ProjectScene {
  /** 这个场景解决什么（故事读者看这一段才知道自己在看什么）。 */
  readonly about: string;
  readonly name: string;
}

/** 场景注册表 —— 「名字 → 真项目」的唯一映射。 */
export const PROJECT_SCENES = {
  /** 空项目：`ProjectCanvas` 最常落的形态（新建项目、什么都没放）。 */
  emptyProject: {
    about: "一个刚建好的空项目（新建项目后落到的状态）",
    name: "Storybook · 空项目",
  },
  /** 有名字的项目：侧栏分组、页签标题、画布标题都用得上这个名字。 */
  namedProject: {
    about: "一个已命名的项目（侧栏与页签都显示这个名字）",
    name: "角色一致性 · 三视图",
  },
} satisfies Record<string, ProjectScene>;

/** 场景名清单（story 的旋钮取自它，不手抄）。 */
export const PROJECT_SCENE_NAMES = Object.keys(PROJECT_SCENES);

/** 场景名的类型（拼错名字在 tsc 就红）。 */
export type ProjectSceneName = keyof typeof PROJECT_SCENES;

/** 取一个场景；名字不认识时**抛错**（与值源 / 画布场景同一条口径）。 */
export function projectScene(name: string): ProjectScene {
  const scene: ProjectScene | undefined =
    PROJECT_SCENES[name as ProjectSceneName];
  if (scene === undefined) {
    throw new Error(
      `项目场景里没有叫「${name}」的那种。现有的：${PROJECT_SCENE_NAMES.join(" / ")}`,
    );
  }
  return scene;
}

/**
 * 用**真 action** 备好一个项目，并把它置为活跃（返回它的 id）。
 *
 * 同名的旧项目先删掉：storybook 的 `localStorage` 跨刷新保留，不删的话每刷新一次
 * 侧栏里就多一个同名项目 —— 那会让「侧栏有几个项目」这件事在画布上不可信。
 *
 * 只应在 story 的 effect 里调用（它写 localStorage）。
 */
export function seedProject(scene: ProjectScene): CanvasProject {
  for (const existing of listProjects()) {
    if (existing.name === scene.name) deleteProject(existing.id);
  }
  const project = createProject(scene.name);
  upsertProject(project);
  setActive(project.id);
  return project;
}

/**
 * 备好一批项目（侧栏的「项目」分组要几条才看得出折叠分组的形态）。
 *
 * 第一个是 `scene`，其余用真 `createProject()` 造出来 —— 名字各不相同，所以
 * `findNextAvailableName()` 不会把它们挤成一个。
 */
export function seedProjects(spec: {
  primary: ProjectScene;
  extraNames: readonly string[];
}): CanvasProject[] {
  const created = [seedProject(spec.primary)];
  for (const name of spec.extraNames) {
    const project = createProject(name);
    upsertProject(project);
    created.push(project);
  }
  setActive(created[0]!.id);
  return created;
}

/**
 * 整屏外框：`AppShell` + **真视图**。
 *
 * `AppShell` 是纯 props 的（`active` / `onSelect` / 回调 / `children`），所以这一层
 * 只做两件事：给真的 `projects` 列表（来自 `canvas-store`，不是手抄的数组）、
 * 把**真视图**塞进 `children`。
 *
 * 视图默认给 `WorksGallery` —— 它真读 canvas-store、零 tRPC 依赖，是这一族里
 * 最省的前提；要看别的视图（工坊 / 产出 / 历史）请到各自的 story 里去取容器，
 * 不要在这里给一个可切换的「视图」旋钮：那会让这份 story 变成一个小型路由器，
 * 而路由本身是 `app/workspace/page.tsx` 的职责。
 */
export function StorybookScreenFrame({
  children,
  projects,
  activeView = "works",
}: {
  /** 真视图（必须是真的 —— 见文件头的第一条口径）。 */
  children?: ReactNode;
  /** 侧栏分组里列出的项目（真 `CanvasProject[]`）。 */
  projects: readonly CanvasProject[];
  activeView?: Parameters<typeof AppShell>[0]["active"];
}) {
  const sidebarProjects = projects.map((project) => ({
    id: project.id,
    name: project.name,
  }));
  const activeProjectId = projects[0]?.id ?? null;

  return (
    <div className="bg-bg h-[720px] w-full overflow-hidden">
      <AppShell
        active={activeView}
        onSelect={() => undefined}
        onOpenSettings={() => undefined}
        projects={sidebarProjects}
        activeProjectId={activeProjectId}
        onOpenProject={() => undefined}
        onShowAllProjects={() => undefined}
        onNewProject={() => undefined}
      >
        {children ?? <WorksGallery />}
      </AppShell>
    </div>
  );
}

/**
 * 工作区型视图的外框（`WorkspaceFrame`）：整屏容器里「工作面积吃满父级」的那一类
 * （画布 / 成片 / 工坊）。与 `StorybookScreenFrame` 分开是因为它们**不是一件事**：
 * 前者是「外壳 + 视图」，后者是「视图内部那圈不出滚动条的框」。
 */
export function StorybookWorkspaceFrame({
  children,
}: {
  children?: ReactNode;
}) {
  return (
    <div className="bg-bg h-[720px] w-full overflow-hidden">
      <WorkspaceFrame>{children}</WorkspaceFrame>
    </div>
  );
}

/** `DocumentFrame` 的文档型外框（整屏一条纵向滚动条的那一类）。 */
export function StorybookDocumentFrame({ children }: { children?: ReactNode }) {
  return (
    <div className="bg-bg h-[720px] w-full overflow-hidden">
      <DocumentFrame>{children}</DocumentFrame>
    </div>
  );
}

/**
 * story 侧备项目的 hook：**在子组件渲染之前**建成，卸载时删。
 *
 * ## 为什么必须是「渲染之前」而不是 `useEffect`
 *
 * `ProjectCanvas` 与 `WorkshopPipeline` 在**挂载那一刻**读 `getActiveId()`
 * （工坊那处是 `useState` 的初始化器，只算一次）。React 的 effect 顺序是
 * **子先父后** —— 放在 `useEffect` 里建项目，子组件读到的是「还没有活跃项目」，
 * 于是工坊的标题落在「未命名项目」上、画布落在空白草稿上，而 story 里摆的
 * 分明是一个有名字的项目。那是这一层最容易静默失效的一处。
 *
 * 所以建项目走 `useState` 的**惰性初始化器**（每次挂载算一次、且在子树渲染之前），
 * 删除仍留在 unmount 的清理里。
 *
 * ## 为什么卸载要删
 *
 * storybook 是长开窗口，来回切 story 会不断堆项目；不清理的话后一份 story 看到的
 * 侧栏里会有前面几份留下的项目 —— 判据在画布上就不可信了。
 *
 * ## 已知边界：StrictMode 下会多建一次
 *
 * React 的 StrictMode 会双调用初始化器与清理。这里对「多建一个同名项目」是**幂等**
 * 的（`seedProject()` 先按名字删旧再建），双调用后剩下的仍是同名的一个 ——
 * 这条边界写在这是为了下一个人不必再查一遍。
 */
export function useSeededProjects(spec: {
  primary: ProjectScene;
  extraNames: readonly string[];
}): CanvasProject[] {
  const [projects] = useState<CanvasProject[]>(() => seedProjects(spec));
  useEffect(() => {
    return () => {
      for (const project of projects) deleteProject(project.id);
    };
  }, [projects]);
  return projects;
}
