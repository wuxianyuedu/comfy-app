import type { Meta, StoryObj } from "@storybook/nextjs";

import { PageLoading } from "~/components/ui/page-loading";

/**
 * 页面级加载态：居中 spinner + 文案，**尺寸随父容器**（本件不自带高度）。
 * 全屏场景传 `h-screen`，页内场景传内容区高度。
 */
const meta = {
  title: "UI/PageLoading",
  component: PageLoading,
  args: { className: "h-64 w-full" },
} satisfies Meta<typeof PageLoading>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** 自定义文案（默认「加载中…」）。 */
export const CustomLabel: Story = {
  args: { label: "正在扫描工作流目录…" },
};

/** `label=""` 时只剩 spinner —— 内联进按钮那种落点用的是 `Spinner` 直连，
 *  这一档是「有边框容器但不想重复文案」的形态。 */
export const WithoutLabel: Story = {
  args: { label: "" },
};
