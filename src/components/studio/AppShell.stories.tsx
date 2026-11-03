import type { Meta, StoryObj } from "@storybook/nextjs";

import { AppShell } from "~/components/studio/AppShell";
import { WorksGallery } from "~/components/studio/WorksGallery";
import { projectScene, useSeededProjects } from "../../../.storybook/screen-frame";
import { tabKey, type ViewTab } from "~/components/studio/workspace-tabs";

/**
 * 应用外壳 —— 第三层注入（整屏容器）的主现场。
 * `children` 装的是**真视图** `WorksGallery`（真读 `canvas-store`），项目列表来自真 action
 * （`useSeededProjects`）；看整屏才看得出的三件事：侧栏两段分界、页签条挂内容列顶端、只有一条 `<main>`。
 */
const meta = {
  title: "Studio/AppShell",
  component: AppShell,
} satisfies Meta<typeof AppShell>;

export default meta;

/** 类型取自适配件（`children` 与真项目列表都在适配件里给）。 */
type Story = StoryObj<typeof ShellHarness>;

/**
 * 真项目 + 真视图：`children` 走 props 而不是写在 JSX 里 —— 它是这份 story 的主变量
 * （§16.2.3.8 按「文件里有没有这个名字的赋值点」认必填 props）。必须是真的：
 * `WorksGallery` 真读 `canvas-store`，不是占位 `<div>`（理由见 `.storybook/screen-frame.tsx` 第一条口径）。
 */
function ShellHarness({
  extraProjects,
  withTabs = false,
  children = <WorksGallery />,
}: {
  /** 壳里装的那一屏（默认给真视图 `WorksGallery`）。 */
  children?: React.ReactNode;
  extraProjects: ReadonlyArray<string>;
  withTabs?: boolean;
}) {
  const projects = useSeededProjects({
    primary: projectScene("namedProject"),
    extraNames: extraProjects,
  });
  const activeProject = projects[0];
  const tabs: Array<ViewTab> = [
    { key: tabKey("works", null), view: "works", projectId: null },
    {
      key: tabKey("canvas", activeProject?.id ?? null),
      view: "canvas",
      projectId: activeProject?.id ?? null,
    },
  ];
  const activeTab = tabs[0];

  return (
    <div className="bg-bg h-180 w-full overflow-hidden">
      <AppShell
        active="works"
        activeProjectId={projects[0]?.id ?? null}
        activeViewKey={withTabs ? activeTab?.key : undefined}
        onCloseViewTab={() => undefined}
        onNewProject={() => undefined}
        onOpenProject={() => undefined}
        onOpenSettings={() => undefined}
        onSelect={() => undefined}
        onSelectViewTab={() => undefined}
        onShowAllProjects={() => undefined}
        projectNameOf={(projectId) =>
          projects.find((project) => project.id === projectId)?.name ?? null
        }
        projects={projects.map((project) => ({
          id: project.id,
          name: project.name,
        }))}
        viewTabs={withTabs ? tabs : undefined}
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
    <ShellHarness extraProjects={["城市夜景", "首帧 → 逐镜生成", "角色设定集", "片头试验"]} />
  ),
};

/** 带视图页签：内容列最顶端那条栏与外框的层级关系（`viewTabs` 由外壳渲染）。 */
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
