import type { Meta, StoryObj } from "@storybook/nextjs";

import { StatusDot } from "~/components/ui/status-dot";

/**
 * 四档状态语义 —— 候选清单是 `StatusDotState` 这个**联合类型**，不是 cva 轴，
 * 所以照 `button.stories.tsx` 的口径从组件 props 派生。
 */
type StatusDotState = NonNullable<
  React.ComponentProps<typeof StatusDot>["state"]
>;

const STATES: StatusDotState[] = ["up", "busy", "probing", "down"];

const meta = {
  title: "UI/StatusDot",
  component: StatusDot,
  args: { state: "up" },
  argTypes: {
    state: { control: "select", options: STATES },
  },
} satisfies Meta<typeof StatusDot>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** 四档语义铺开：`up` 已就绪 / `busy` 过渡态（不是失败）/ `probing` 结论未出 / `down` 明确未运行。 */
export const States: Story = {
  render: () => (
    <div className="flex flex-col gap-2">
      {STATES.map((state) => (
        <span
          key={state}
          className="text-ink-muted flex items-center gap-2 text-xs"
        >
          <StatusDot state={state} />
          {state}
        </span>
      ))}
    </div>
  ),
};

/** 尺寸档 + 脉冲：`pulse` 给「跟随中」这类持续进行中的指示，行内小点传 `size-1.5`。 */
export const SizesAndPulse: Story = {
  render: () => (
    <div className="flex items-center gap-4">
      <StatusDot state="up" sizeClass="size-1.5" />
      <StatusDot state="up" />
      <StatusDot state="busy" sizeClass="size-3" pulse />
    </div>
  ),
};
