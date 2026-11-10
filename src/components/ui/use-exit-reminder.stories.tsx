import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { ExitReminder, exitReminderSignal } from "~/components/ui/use-exit-reminder";

/**
 * 判据全在 CSS（`globals.css` 的 `[data-exit-reminder]:has(~ [data-dirty])`）：容器挂 `data-dirty`
 * 且提示条是其**同级后继兄弟**，主题 CSS 与 `globals.css` 也都在 —— 三者缺一就表现为
 * 「组件在 DOM 里却看不见」，与真机不一致，story 反而让人误判组件坏了。铺开两种状态定这件事。
 */
const meta = {
  title: "UI/ExitReminder",
  component: ExitReminder,
  args: {
    children: "切走这一阶段后这里的内容会被清空，需要先导出或复制保留。",
  },
} satisfies Meta<typeof ExitReminder>;

export default meta;

type Story = StoryObj<typeof meta>;

/** 没有会丢的东西：整条不在可见流里（`display: none`），但仍挂在 DOM 上。 */
export const Idle: Story = {
  render: (args) => (
    <div className="text-ink-soft flex flex-col gap-2 text-sm">
      <span>下面是「没有脏数据」时的形态 —— 它不占位：</span>
      <div className="border-border border border-dashed p-2">
        <div {...exitReminderSignal(false)}>
          <ExitReminder {...args} />
          <span className="text-ink-faint text-xs">（提示条在上面这一行里，看不见）</span>
        </div>
      </div>
    </div>
  ),
};

/** 有会丢的东西：提示条显形。信号在**同级**容器上，提示条是它的后继兄弟 —— 这正是 `~` 要求的形状。 */
export const Shown: Story = {
  render: (args) => (
    <div className="text-ink-soft flex flex-col gap-2 text-sm">
      <span>下面是「有脏数据」时的形态：</span>
      <div className="border-border border border-dashed p-2">
        <div {...exitReminderSignal(true)}>
          <span className="text-ink-faint text-xs">（这一层带着 data-dirty）</span>
          <ExitReminder {...args} className="text-ink-faint mt-1 text-[11px]" />
        </div>
      </div>
    </div>
  ),
};
