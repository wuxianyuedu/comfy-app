import type { Meta, StoryObj } from "@storybook/nextjs";
import { FolderTree, TriangleAlert } from "lucide-react";

import { Button } from "~/components/ui/button";
import { EmptyState } from "~/components/ui/empty-state";

const meta = {
  title: "UI/EmptyState",
  component: EmptyState,
  args: {
    title: "还没有工作流",
    description: "从磁盘导入一个 workflow.json，或直接在画布上新建。",
    icon: FolderTree,
  },
} satisfies Meta<typeof EmptyState>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Page: Story = {};

export const WithAction: Story = {
  args: {
    action: <Button variant="outline">导入工作流</Button>,
  },
};

export const Error: Story = {
  args: {
    variant: "error",
    title: "加载失败",
    description: "磁盘上的工作流目录不可读，请检查路径后重试。",
    icon: TriangleAlert,
  },
};

/** `hint` 是行内提示条，不是居中卡片——用同一段说明它的形态边界。 */
export const Hint: Story = {
  args: {
    variant: "hint",
    title: "该工作流未暴露对外参数",
  },
};
