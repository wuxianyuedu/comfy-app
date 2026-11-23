import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { TimeAgo } from "~/components/ui/time-ago";

/** 水合安全口径（ISSUE #4852）：占位与真实相对时间的文案都从这里出。 */
const meta = {
  title: "UI/TimeAgo",
  component: TimeAgo,
  args: { value: new Date(Date.now() - 5 * 60_000).toISOString() },
} satisfies Meta<typeof TimeAgo>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** 带后缀（workspace 首页副标题的「……修改」形态）。 */
export const WithSuffix: Story = { args: { suffix: "修改" } };

/** 超过 maxDays 的兜底文案形态。 */
export const OverMaxDays: Story = {
  args: {
    fallback: "时间未知",
    maxDays: 7,
    value: new Date(Date.now() - 30 * 86_400_000).toISOString(),
  },
};
