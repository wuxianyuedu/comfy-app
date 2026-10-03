import type { Meta, StoryObj } from "@storybook/nextjs";

import { Label } from "~/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";

/**
 * `ui/select` 是 base-ui Select 的封装（**受控浮层的下拉**，与原生
 * `native-select` 不同族）。本仓在这一层做过**有意改动**（`ui-customized`
 * 标记，规范 16 §16.8），story 要盯的正是这几处：
 *
 * 1. **`alignItemWithTrigger` 默认 `false`**：base-ui 的原生默认是 `true`，
 *    它让弹层位置随选中项上下移动 —— 选中末尾项时弹层被顶到视口上方、
 *    前半截出屏。本仓改成不把「已选项」对齐到触发器（同款修复见
 *    `ui/select-menu` 与规范 07 §7.21.4）。要看这条差别：**选中最后一项**
 *    再重新打开，弹层应该还在触发器下方。
 * 2. **`SelectTrigger` 的 `size` 两档**（`sm` / `default`）：改高度与圆角。
 * 3. **定位层读 `useOverlayBoundary()`**（视口减去应用级标题行）。
 *
 * 与 `ui/select-menu` 的分工：那个是项目内「模型选择器」那类**带富标签**的
 * 出口（33 处消费点）；本件是通用基座。轻量、选项少、想省浮层的场景用
 * `native-select`。
 */
type SelectTriggerSize = NonNullable<
  React.ComponentProps<typeof SelectTrigger>["size"]
>;

const TRIGGER_SIZES: SelectTriggerSize[] = ["sm", "default"];

const meta = {
  title: "UI/Select",
  component: SelectTrigger,
  args: { size: "default" },
  argTypes: {
    size: { control: { type: "select" }, options: TRIGGER_SIZES },
  },
} satisfies Meta<typeof SelectTrigger>;

export default meta;

type Story = StoryObj<typeof meta>;

/** 最常用：受控下拉 + 占位文案。 */
export const Default: Story = {
  render: (args) => (
    <div className="flex w-56 flex-col gap-1.5">
      <Label htmlFor="select-format">输出格式</Label>
      <Select defaultValue="png">
        <SelectTrigger {...args} id="select-format">
          <SelectValue placeholder="选一个格式" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="png">PNG</SelectItem>
          <SelectItem value="jpg">JPG</SelectItem>
          <SelectItem value="webp">WebP</SelectItem>
        </SelectContent>
      </Select>
    </div>
  ),
};

/** 两档 `size` 并列：`sm` 是 `h-7` + 更小圆角（工具条里跟 `xs` 按钮并排时用）。 */
export const TriggerSizes: Story = {
  render: () => (
    <div className="flex items-center gap-4">
      {TRIGGER_SIZES.map((size) => (
        <Select key={size} defaultValue="a">
          <SelectTrigger size={size}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="a">size={size}</SelectItem>
          </SelectContent>
        </Select>
      ))}
    </div>
  ),
};

/** 分组 + 标签 + 分隔线：选项多时的标准排法（分组标题走 `SelectLabel`）。 */
export const Grouped: Story = {
  render: (args) => (
    <Select defaultValue="sd_xl">
      <SelectTrigger {...args}>
        <SelectValue placeholder="选一个模型" />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          <SelectLabel>基础模型</SelectLabel>
          <SelectItem value="sd_xl">sd_xl_base_1.0</SelectItem>
          <SelectItem value="flux">flux1-dev</SelectItem>
        </SelectGroup>
        <SelectSeparator />
        <SelectGroup>
          <SelectLabel>编辑模型</SelectLabel>
          <SelectItem value="qwen">qwen_image_edit</SelectItem>
        </SelectGroup>
      </SelectContent>
    </Select>
  ),
};

/**
 * 这条是给 `alignItemWithTrigger` 那个改动用的现场：**选中最后一个**再
 * 重新打开 —— 弹层应该还落在触发器**下方**（`alignItemWithTrigger=false`）。
 * 如果它跳到视口上方 / 前半截出屏，说明那一档被改回 `true` 了。
 */
export const AlignItemWithTriggerOff: Story = {
  render: (args) => (
    <div className="flex w-56 flex-col gap-2">
      <span className="text-ink-muted text-xs">
        选最后一项，再重新打开看弹层还在不在下方
      </span>
      <Select defaultValue="i1">
        <SelectTrigger {...args}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {Array.from({ length: 12 }, (_, index) => (
            <SelectItem key={index} value={`i${String(index + 1)}`}>
              选项 {index + 1}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  ),
};

/** 三态：正常 / 禁用（`disabled:cursor-not-allowed`）/ 错误
 *  （`aria-invalid` 走 `border-destructive`）。 */
export const States: Story = {
  render: (args) => (
    <div className="flex flex-col items-start gap-4">
      <Select defaultValue="a">
        <SelectTrigger {...args}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="a">正常</SelectItem>
        </SelectContent>
      </Select>
      <Select defaultValue="a" disabled>
        <SelectTrigger {...args}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="a">禁用</SelectItem>
        </SelectContent>
      </Select>
      <Select defaultValue="a">
        <SelectTrigger {...args} aria-invalid>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="a">错误（aria-invalid）</SelectItem>
        </SelectContent>
      </Select>
    </div>
  ),
};
