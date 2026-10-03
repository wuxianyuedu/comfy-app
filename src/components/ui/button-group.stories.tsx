import { Bold, Italic, Redo2, Undo2, Underline } from "lucide-react";
import type { Meta, StoryObj } from "@storybook/nextjs";

import { Button } from "~/components/ui/button";
import { ButtonGroup } from "~/components/ui/button-group";
import { Input } from "~/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";

/**
 * `ui/button-group` 是**把相邻按钮粘成一条**的容器：只做「圆角与边框的接缝」
 * 那件事 —— 中间的项左圆角归零、右圆角归零，相邻项之间去掉重复的边框。
 *
 * 它自己不是按钮，也不改子元素的其它形态，所以 story 要看的是**接缝**：
 * 单独一个按钮看不出任何效果，得两个以上才成立。
 *
 * 三件事只有渲染出来才知道：
 * 1. `orientation` 两档：`horizontal`（横向接缝）/ `vertical`（纵向，改的是
 *    上下圆角与 `border-t`）；
 * 2. **不同基元混排也行**：`Button` / `SelectTrigger` / `Input` 放进同一个组，
 *    靠 `[&>[data-slot]]` 那套选择器统一接缝 —— 这一条是本件比「手写
 *    `-ml-px`」强的地方；
 * 3. `has-[>[data-slot=button-group]]:gap-2`：**嵌套**时外层改用 `gap`，
 *    不再做接缝合并（否则两组的接缝会互相吃掉）。
 */
type ButtonGroupOrientation = NonNullable<
  React.ComponentProps<typeof ButtonGroup>["orientation"]
>;

const ORIENTATIONS: ButtonGroupOrientation[] = ["horizontal", "vertical"];

const meta = {
  title: "UI/ButtonGroup",
  component: ButtonGroup,
  args: { orientation: "horizontal" },
  argTypes: {
    orientation: { control: "select", options: ORIENTATIONS },
  },
} satisfies Meta<typeof ButtonGroup>;

export default meta;

type Story = StoryObj<typeof meta>;

/** 最常用：文字样式工具条（三档按钮粘成一条）。 */
export const Default: Story = {
  render: (args) => (
    <ButtonGroup {...args}>
      <Button variant="outline" size="icon-sm" aria-label="加粗">
        <Bold />
      </Button>
      <Button variant="outline" size="icon-sm" aria-label="斜体">
        <Italic />
      </Button>
      <Button variant="outline" size="icon-sm" aria-label="下划线">
        <Underline />
      </Button>
    </ButtonGroup>
  ),
};

/** 撤销 / 重做：两档并排看**接缝** —— 中间的边只出现一次，两侧的圆角各自保留。 */
export const TwoButtons: Story = {
  render: (args) => (
    <div className="flex flex-col gap-4">
      <ButtonGroup {...args}>
        <Button variant="outline" size="sm">
          <Undo2 /> 撤销
        </Button>
        <Button variant="outline" size="sm">
          <Redo2 /> 重做
        </Button>
      </ButtonGroup>
      <span className="text-ink-muted text-xs">
        两档之间那条边只出现一次（这就是本件做的事）
      </span>
    </div>
  ),
};

/** 两档 `orientation`：竖排时接缝换到上下（圆角与 `border-t` 一起改）
 *  —— 横排看不出竖排做没做对。 */
export const Orientations: Story = {
  render: () => (
    <div className="flex items-start gap-8">
      {ORIENTATIONS.map((orientation) => (
        <div key={orientation} className="flex flex-col gap-1.5">
          <span className="text-ink-muted font-mono text-[11px]">
            orientation={orientation}
          </span>
          <ButtonGroup orientation={orientation}>
            <Button variant="outline" size="sm">
              上
            </Button>
            <Button variant="outline" size="sm">
              中
            </Button>
            <Button variant="outline" size="sm">
              下
            </Button>
          </ButtonGroup>
        </div>
      ))}
    </div>
  ),
};

/** **不同基元混排**：按钮 + 下拉 + 输入框同处一组，接缝仍然统一。
 *  这一条是本件比「每处手写 `-ml-px`」强的直接证据 ——
 *  那套选择器按 `[data-slot]` 取元素，不认具体是哪个组件。 */
export const MixedPrimitives: Story = {
  render: (args) => (
    <ButtonGroup {...args} className="w-[28rem]">
      <Select defaultValue="t2i">
        <SelectTrigger className="w-32">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="t2i">文生图</SelectItem>
          <SelectItem value="i2i">图生图</SelectItem>
        </SelectContent>
      </Select>
      <Input placeholder="提示词…" />
      <Button variant="outline">运行</Button>
    </ButtonGroup>
  ),
};

/** 嵌套：内层组与外层组之间用 `gap` 分开（`has-[>[data-slot=button-group]]:gap-2`）
 *  —— 不这么写的话两层的接缝会互相吃掉、圆角全乱。 */
export const Nested: Story = {
  render: (args) => (
    <ButtonGroup {...args}>
      <ButtonGroup>
        <Button variant="outline" size="sm">
          左一
        </Button>
        <Button variant="outline" size="sm">
          左二
        </Button>
      </ButtonGroup>
      <ButtonGroup>
        <Button variant="outline" size="sm">
          右一
        </Button>
        <Button variant="outline" size="sm">
          右二
        </Button>
      </ButtonGroup>
    </ButtonGroup>
  ),
};
