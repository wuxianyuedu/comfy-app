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

/**
 * `panel` 是**面板里铺满居中的轻量占位**（日志面板 / 控制台输出 / CLI 原文模态
 * 那一族，收口前 6 处调用点各抄一份同样的类名）：无框、无内距、图标 30% 透明。
 * 它吃的是父级高度，所以这里给一个有高度的框 —— 换个塌成一行的父级，这一档
 * 的形态根本看不出来（`h-full` 在没有确定高度的父级里不生效）。
 */
export const Panel: Story = {
  render: () => (
    <div className="bg-canvas-deep h-70 w-md">
      <EmptyState
        variant="panel"
        icon={FolderTree}
        title="运行生成后此处会显示执行步骤日志"
      />
    </div>
  ),
};
