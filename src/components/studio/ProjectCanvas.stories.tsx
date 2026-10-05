import type { Meta, StoryObj } from "@storybook/nextjs";

import { ProjectCanvas } from "~/components/studio/ProjectCanvas";
import {
  projectScene,
  useSeededProjects,
  type ProjectSceneName,
} from "../../../.storybook/screen-frame";

/**
 * 项目画布 —— 整屏容器这一族的**主屏**（第三层注入）。
 *
 * 它一个 prop 都不收（`seedNew` / `pendingWorkflow` 缺省即最常用的那一档），
 * 从 `canvas-store` 读当前活跃项目、从 tRPC 读 production 进度。所以 story 要做
 * 的不是「给 props」，而是**先让 canvas-store 里真的有一个活跃项目** ——
 * 这一步走真 action `createProject()`（与用户点「新建项目」同一条路），
 * 而不是手拼一个 `CanvasProject` 字面量：名字撞不撞、有没有置活跃都在这套规则里，
 * 跳过它们正是真机上「打开项目看到空白」的常见根因。
 *
 * 它自带 `<ReactFlowProvider>`（见 `ProjectCanvas` 的公共出口），所以**不需要**
 * 第二层那个注入层 —— 这也是「三层注入各管一段」的边界：这一屏要的是真项目与
 * 真外壳，不是一块拼出来的画布。
 *
 * 画布上看到的默认是**空项目**（一张真画布 + 空态引导卡）。tRPC 那一侧的形态
 * 与 `data-sources.tsx` 里写的一致：应用没起时看的是真实的**降级形态**，
 * 那不是 story 坏了。
 */
const meta = {
  title: "Studio/ProjectCanvas",
  component: ProjectCanvas,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof ProjectCanvas>;

export default meta;

type Story = StoryObj<typeof ProjectCanvasHarness>;

/** 适配件：备好真项目，再把画布整屏摆出来。 */
function ProjectCanvasHarness({ sceneName }: { sceneName: ProjectSceneName }) {
  /* 备好之后画布自己会从 canvas-store 读回同一批（真读，不是 props 传）。 */
  useSeededProjects({ primary: projectScene(sceneName), extraNames: [] });
  return (
    <div className="bg-canvas h-180 w-full overflow-hidden">
      <ProjectCanvas />
    </div>
  );
}

/** 空项目：真画布 + 空态引导卡（新建项目之后最常落在的状态）。 */
export const EmptyProject: Story = {
  render: () => <ProjectCanvasHarness sceneName="emptyProject" />,
};

/** 已命名项目：画布标题栏显示真名字（那是它在真机上的形态）。 */
export const NamedProject: Story = {
  render: () => <ProjectCanvasHarness sceneName="namedProject" />,
};

/**
 * **有内容**的项目（`filledProject`）：四张真节点 + 三条连线落在真画布上。
 *
 * 与 `EmptyProject` 分开是因为它们看的是两件事：空项目看的是**空态引导卡**
 *（`EmptyCanvasHint`），这一档看的是**节点本身**在真画布里的形态 —— 端点几何、
 * 连线路径、状态徽标、类型章。节点数据走 `placeCanvasNode()`（建节点的唯一出口），
 * 所以画布上摆的是真形状，不是手拼的两个字段。
 */
export const FilledProject: Story = {
  render: () => <ProjectCanvasHarness sceneName="filledProject" />,
};

/**
 * 名字很长的项目（`longNameProject`）：画布标题栏要**截断**而不是撑破。
 * 真机上项目名是用户自己起的一句话，长名是最常见的形态。
 */
export const LongNameProject: Story = {
  render: () => <ProjectCanvasHarness sceneName="longNameProject" />,
};
