import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { WorkshopPipeline } from "~/components/workshop/WorkshopPipeline";
import { projectScene, useSeededProjects } from "../../../.storybook/screen-frame";

/**
 * 工坊管线 —— 薄容器整屏（第三层注入）。story 要给的前提：**活跃项目必须在子树渲染前建好**（`getActiveId()` 在挂载那一刻读，`useSeededProjects()` 因此走
 * 惰性初始化器）；tRPC 链路没起时看到的是真实降级形态，不是 story 坏了。注意：顶栏显示的是**草稿**的 `meta.title`（默认「未命名项目」）而非项目名，那是真实行为。
 * 要看整屏才看得出的：窄屏下中列会不会被挤没、整屏只有一条纵向滚动条。
 */
const meta = {
  title: "Workshop/WorkshopPipeline",
  component: WorkshopPipeline,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof WorkshopPipeline>;

export default meta;

type Story = StoryObj<typeof WorkshopPipelineHarness>;

/** 适配件：备好真项目，再把整屏摆出来。 */
function WorkshopPipelineHarness({ extraNames = [] }: { extraNames?: ReadonlyArray<string> }) {
  useSeededProjects({
    primary: projectScene("namedProject"),
    extraNames,
  });
  return (
    <div className="bg-bg text-ink h-180 w-full overflow-hidden">
      <WorkshopPipeline />
    </div>
  );
}

/**
 * 整屏（默认宽度）：三列 + 阶段轨道。后端没起时是真实**降级形态** —— 骨架在、
 * 内容是空态（真机上这档最难复现：要么全起、要么全不起）。
 */
export const Default: Story = {
  render: () => <WorkshopPipelineHarness />,
};

/**
 * 多个项目在场：工坊读的是**活跃项目**（`getActiveId()`，挂载那一刻），与列表里
 * 第一个不是同一件事（备项目时最后把活跃设回第一个，故这里看到的仍是 `namedProject`）。
 */
export const WithOtherProjects: Story = {
  render: () => (
    <WorkshopPipelineHarness extraNames={["城市夜景", "首帧 → 逐镜生成", "片头试验"]} />
  ),
};
