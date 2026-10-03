import { Info, Trash2 } from "lucide-react";
import type { Meta, StoryObj } from "@storybook/nextjs";

import { Button } from "~/components/ui/button";
import { Hint } from "~/components/ui/hint";

/**
 * `Hint` 是「给一个控件配悬停提示」的**全库唯一出口**（规范 16 §16.2.3 P82）。
 *
 * 为什么不直接写 `<Tooltip>` 三件套：形态固定（Trigger 必用 base-ui 的
 * `render` prop 接管子元素，不用 `asChild`），逐点手写会在视图里长出几十份
 * 近似结构（§12.12 孪生判据）。这里收一次，调用点只多一对标签。
 *
 * 它替掉原生 `title=`，因为后者有三个短板：读屏器支持长期不一致
 * （Safari + VoiceOver 直接忽略）、显示延迟与样式不受主题控制、不能挂 kbd /
 * 富文本。
 *
 * ## 三条与规范 §6.1 的接缝（本 story 要看的正是它们）
 *
 * 1. **有可见文字的按钮不要给 `aria-label`** —— 名字已由文字给出，另写一份会撞
 *    WCAG 2.5.3「label in name」；
 * 2. **纯图标按钮**（`<X />` / `✕` / `⋮` 这类**不含字母与数字**的字形）传
 *    `accessibleName`，由本组件把 `label` 同时写成子元素的 `aria-label`；
 * 3. **带字母或数字的就是可见文字**（`A-` / `5×` /「错误」）—— 一律不补名。
 *
 * ⚠️ 提示要**悬停**才出现；禁用态那条要看 `wrap` 的现场（见下）。
 */
const meta = {
  title: "UI/Hint",
  component: Hint,
  args: {
    label: "提示文案",
    children: <Button variant="outline">目标</Button>,
  },
} satisfies Meta<typeof Hint>;

export default meta;

type Story = StoryObj<typeof meta>;

/** 有可见文字的按钮：**不传 `accessibleName`** —— 名字由文字给。 */
export const TextButton: Story = {
  render: (args) => <Hint {...args} label="这一段会写进工作流模板" />,
};

/** 纯图标按钮：**必须开 `accessibleName`**（`<Trash2 />` 不含字母与数字，
 *  否则这个按钮对读屏器没有名字）。`Hint` 会把 `label` 同时写成
 *  子元素的 `aria-label`。 */
export const IconOnlyButton: Story = {
  render: () => (
    <Hint label="删除这个工作流" accessibleName>
      <Button size="icon-sm" variant="danger">
        <Trash2 />
      </Button>
    </Hint>
  ),
};

/** 带字母 / 数字的图标按钮：`A-` / `5×` 这类**算可见文字**，一律不补名
 *  —— 这条与上一档的判据是「字形里有没有字母或数字」，不是「是不是按钮」。 */
export const IconWithLetters: Story = {
  render: () => (
    <Hint label="缩小字号">
      <Button size="sm" variant="outline">
        A-
      </Button>
    </Hint>
  ),
};

/** 富内容：提示里可以挂 `<kbd>`（原生 `title=` 做不到）—— 快捷键说明
 *  是这一档最常见的用法。 */
export const RichContent: Story = {
  render: () => (
    <Hint
      label={
        <span className="flex items-center gap-1">
          打开命令面板
          <kbd className="rounded border px-1 font-mono text-[10px]">⌘K</kbd>
        </span>
      }
    >
      <Button variant="outline">
        <Info /> 命令面板
      </Button>
    </Hint>
  ),
};

/** 禁用态的按钮：**传 `wrap`** —— 浏览器对 `disabled` 元素根本不发指针事件，
 *  提示不会弹（原生 `title` 反而会弹）。`wrap` 把提示挂在一层
 *  `inline-flex` 锚点上，「为什么不能点」就还能说出口。 */
export const DisabledNeedsWrap: Story = {
  render: () => (
    <div className="flex items-center gap-6">
      <div className="flex flex-col items-center gap-1.5">
        <Hint label="这样不会有提示（disabled 不发指针事件）">
          <Button variant="outline" disabled>
            禁用（无 wrap）
          </Button>
        </Hint>
        <span className="text-ink-muted font-mono text-[11px]">不给 wrap</span>
      </div>
      <div className="flex flex-col items-center gap-1.5">
        <Hint wrap label="工作流正在运行，先停掉再删除">
          <Button variant="outline" disabled>
            禁用（带 wrap）
          </Button>
        </Hint>
        <span className="text-ink-muted font-mono text-[11px]">给 wrap</span>
      </div>
    </div>
  ),
};
