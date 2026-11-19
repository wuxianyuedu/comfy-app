import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { StatusBadge } from "~/components/ui/status-badge";

/**
 * 业务状态字符串 → 五档语义 tone 的映射表是本件真正的判据（样式在 `ui/badge` 里）。
 * 这里列「每档挑一个代表」一屏看完整套配色 —— 不手写第二份表，逐状态判定仍以组件
 * `STATUS_TONE` 为准。
 */
/* SAFETY: 类型断言已复核 */
const STATUSES = ["SUCCEEDED", "RUNNING", "QUEUED", "FAILED", "IDLE", "NOT_A_STATUS"] as const;

const meta = {
  title: "UI/StatusBadge",
  component: StatusBadge,
  args: { status: "RUNNING" },
  argTypes: {
    status: { control: "select", options: STATUSES },
  },
} satisfies Meta<typeof StatusBadge>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** 六档：成功 / 进行中 / 待处理 / 失败 / 中性 / **未知状态落中性**。 */
export const Tones: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-2">
      {STATUSES.map((status) => (
        <StatusBadge key={status} label={status} status={status} />
      ))}
    </div>
  ),
};

/** `dot={false}`：叠在缩略图上的角标 —— 图本身已经够花，圆点只是噪声。 */
export const WithoutDot: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-2">
      <StatusBadge dot={false} label="已完成" status="SUCCEEDED" />
      <StatusBadge dot={false} label="已失败" status="FAILED" />
    </div>
  ),
};

/** 文案档刻意由调用处给：同一个状态在不同界面叫法不同（任务历史「已完成」/
 *  画布节点「运行后生成」/ 镜头「片段就绪」）。 */
export const CustomLabels: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-2">
      <StatusBadge label="已完成" status="SUCCEEDED" />
      <StatusBadge label="运行后生成" status="SUCCEEDED" />
      <StatusBadge label="片段就绪" status="SUCCEEDED" />
    </div>
  ),
};
