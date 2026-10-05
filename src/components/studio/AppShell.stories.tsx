import type { Meta, StoryObj } from "@storybook/nextjs";

import { AppShell } from "~/components/studio/AppShell";
import { WorksGallery } from "~/components/studio/WorksGallery";
import {
  projectScene,
  useSeededProjects,
} from "../../../.storybook/screen-frame";
import { tabKey, type ViewTab } from "~/components/studio/workspace-tabs";

/**
 * 应用外壳 —— 第三层注入（整屏容器）的主现场。
 *
 * 它本身是纯 props 的，难点不在 props 而在**壳里装什么**：`children` 摆一个
 * `<div>内容</div>`，画布上看到的是「外壳围着一块占位符」—— 那证明不了任何事。
 * 所以这份 story 装的是**真视图** `WorksGallery`（它真读 `canvas-store`），
 * 侧栏那份项目列表也来自**真 action** 建出来的项目（`useSeededProjects`，
 * 与用户点「新建项目」同一条路）。
 *
 * 要看的是整屏才看得出来的三件事：
 *
 *  · **侧栏两段的分界**：顶部全局项常驻，底部「项目」是折叠分组 —— 项目多了之后
 *    分组会不会把侧栏吃掉；
 *  · **页签条挂在内容列里**：`viewTabs` 由外壳在内容列渲染，`inTitleBar` 那一档
 *    是换背景层级，不是换位置（关一份页签不能连带切页签）；
 *  · **一整屏只有一条 `<main>`**：外壳的 `SidebarInset` 是它，视图容器不再套。
 */
const meta = {
  title: "Studio/AppShell",
  component: AppShell,
} satisfies Meta<typeof AppShell>;

export default meta;

/** 类型取自适配件（`children` 与真项目列表都在适配件里给）。 */
type Story = StoryObj<typeof ShellHarness>;

/**
 * 真项目 + 真视图：侧栏项目分组与内容列同时有东西可看。
 *
 * `children` 走 props 而不是写在 JSX 里 —— 外壳的 `children` 就是「壳里装什么」，
 * 而那正是这份 story 的**主变量**（§16.2.3.8 的故事面判据按「文件里有没有这个名字
 * 的赋值点」认必填 props：不给它，判据读到的是「story 没回答壳里装什么」）。
 *
 * 它必须是真的：`WorksGallery` 真读 `canvas-store`，不是占位 `<div>`
 *（理由见 `.storybook/screen-frame.tsx` 的第一条口径）。
 */
function ShellHarness({
  extraProjects,
  withTabs = false,
  children = <WorksGallery />,
}: {
  extraProjects: readonly string[];
  withTabs?: boolean;
  /** 壳里装的那一屏（默认给真视图 `WorksGallery`）。 */
  children?: React.ReactNode;
}) {
  const projects = useSeededProjects({
    primary: projectScene("namedProject"),
    extraNames: extraProjects,
  });
  const activeProject = projects[0];
  const tabs: ViewTab[] = [
    { key: tabKey("works", null), view: "works", projectId: null },
    {
      key: tabKey("canvas", activeProject?.id ?? null),
      view: "canvas",
      projectId: activeProject?.id ?? null,
    },
  ];
  const activeTab = tabs[0];

  return (
    <div className="bg-bg h-[720px] w-full overflow-hidden">
      <AppShell
        active="works"
        onSelect={() => undefined}
        onOpenSettings={() => undefined}
        projects={projects.map((project) => ({
          id: project.id,
          name: project.name,
        }))}
        activeProjectId={projects[0]?.id ?? null}
        onOpenProject={() => undefined}
        onShowAllProjects={() => undefined}
        onNewProject={() => undefined}
        viewTabs={withTabs ? tabs : undefined}
        activeViewKey={withTabs ? activeTab?.key : undefined}
        projectNameOf={(projectId) =>
          projects.find((project) => project.id === projectId)?.name ?? null
        }
        onSelectViewTab={() => undefined}
        onCloseViewTab={() => undefined}
      >
        {children}
      </AppShell>
    </div>
  );
}

/** 一个项目：侧栏「项目」分组里只有一项（折叠分组最简形态）。 */
export const SingleProject: Story = {
  render: () => <ShellHarness extraProjects={[]} />,
};

/** 五个项目：分组展开后侧栏会不会被吃掉（那是这一屏最常出问题的地方）。 */
export const ManyProjects: Story = {
  render: () => (
    <ShellHarness
      extraProjects={["城市夜景", "首帧 → 逐镜生成", "角色设定集", "片头试验"]}
    />
  ),
};

/** 带视图页签：内容列顶部那条栏与外框的层级关系（`viewTabs` 由外壳渲染）。 */
export const WithViewTabs: Story = {
  render: () => <ShellHarness extraProjects={["城市夜景"]} withTabs />,
};

/**
 * 名字很长 + 项目很多：侧栏「项目」分组的**截断与折叠**是同一处要看的 ——
 * 真机上用户起的是「一句描述」那么长的名字，而侧栏宽度固定。
 */
export const LongNamesAndMany: Story = {
  render: () => (
    <ShellHarness
      extraProjects={[
        "角色一致性 · 三视图 + 首帧逐镜生成（第 2 版）",
        "城市夜景重制 · 雨后的霓虹街道",
        "片头试验",
        "分镜草稿",
      ]}
    />
  ),
};
