import type { Meta, StoryObj } from "@storybook/nextjs";

import { ListBadge } from "~/components/ui/list-badge";

/**
 * 五档 tone 从 props 派生（与 `button.stories.tsx` 同一口径：不从任何
 * 变体表的返回值上取枚举）。`title` 是**悬停说明**，不是可访问名 ——
 * 徽标本身有可见文字，名字该由文字自己给（规范 §6.1）。
 */
type ListBadgeTone = NonNullable<
  React.ComponentProps<typeof ListBadge>["tone"]
>;

const TONES: ListBadgeTone[] = [
  "neutral",
  "success",
  "warning",
  "danger",
  "primary",
];

const meta = {
  title: "UI/ListBadge",
  component: ListBadge,
  args: { children: "本地", tone: "neutral" },
  argTypes: {
    tone: { control: "select", options: TONES },
  },
} satisfies Meta<typeof ListBadge>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Tones: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-2">
      {TONES.map((tone) => (
        <ListBadge key={tone} tone={tone}>
          {tone}
        </ListBadge>
      ))}
    </div>
  ),
};

/**
 * 真实落点：跟在列表行标题后面的一排元信息 —— 这是「为什么不能复用
 * `status-badge`」的现场（`text-xs` 胶囊会把按「一行文字」定的行高撑成两倍）。
 */
export const InListRow: Story = {
  render: () => (
    <div className="border-border flex w-72 items-center gap-1.5 overflow-hidden border-b py-1.5">
      <span className="truncate text-xs">角色一致性工作流</span>
      <ListBadge tone="warning" title="未配置：提示词口未落到端口">
        对外参数未配置
      </ListBadge>
      <ListBadge tone="success">本地</ListBadge>
    </div>
  ),
};
