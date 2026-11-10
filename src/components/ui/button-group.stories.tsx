import { Bold, Italic, Redo2, Undo2, Underline } from "lucide-react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";

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
 * `ui/button-group` 把相邻按钮粘成一条：只做圆角与边框接缝（中间项圆角归零、相邻项去掉重复边框），自身不是按钮；`orientation` 两档（horizontal / vertical 改上下圆角与 `border-t`）。
 * 不同基元（Button / SelectTrigger / Input）混排靠 `[&>[data-slot]]` 统一接缝；`has-[>[data-slot=button-group]]:gap-2` 让嵌套外层改用 `gap`，否则两组的接缝会互相吃掉。
 */
type ButtonGroupOrientation = NonNullable<React.ComponentProps<typeof ButtonGroup>["orientation"]>;

const ORIENTATIONS: Array<ButtonGroupOrientation> = ["horizontal", "vertical"];

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
      <Button aria-label="加粗" size="icon-sm" variant="outline">
        <Bold />
      </Button>
      <Button aria-label="斜体" size="icon-sm" variant="outline">
        <Italic />
      </Button>
      <Button aria-label="下划线" size="icon-sm" variant="outline">
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
        <Button size="sm" variant="outline">
          <Undo2 /> 撤销
        </Button>
        <Button size="sm" variant="outline">
          <Redo2 /> 重做
        </Button>
      </ButtonGroup>
      <span className="text-ink-muted text-xs">两档之间那条边只出现一次（这就是本件做的事）</span>
    </div>
  ),
};

/** 两档 `orientation`：竖排时接缝换到上下（圆角与 `border-t` 一起改）
 *  —— 横排看不出竖排做没做对。 */
export const Orientations: Story = {
  render: () => (
    <div className="flex items-start gap-8">
      {ORIENTATIONS.map((orientation) => (
        <div className="flex flex-col gap-1.5" key={orientation}>
          <span className="text-ink-muted font-mono text-[11px]">orientation={orientation}</span>
          <ButtonGroup orientation={orientation}>
            <Button size="sm" variant="outline">
              上
            </Button>
            <Button size="sm" variant="outline">
              中
            </Button>
            <Button size="sm" variant="outline">
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
    <ButtonGroup {...args} className="w-md">
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
        <Button size="sm" variant="outline">
          左一
        </Button>
        <Button size="sm" variant="outline">
          左二
        </Button>
      </ButtonGroup>
      <ButtonGroup>
        <Button size="sm" variant="outline">
          右一
        </Button>
        <Button size="sm" variant="outline">
          右二
        </Button>
      </ButtonGroup>
    </ButtonGroup>
  ),
};
