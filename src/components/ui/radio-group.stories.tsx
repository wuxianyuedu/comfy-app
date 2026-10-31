import type { Meta, StoryObj } from "@storybook/nextjs";

import { Label } from "~/components/ui/label";
import { RadioGroup, RadioGroupItem } from "~/components/ui/radio-group";

/**
 * `ui/radio-group` 是 base-ui 的 Radio：**单选组**（组里同时只有一项选中）。
 *
 * 与 `ui/checkbox` 的分工要说清，否则很容易写错：勾选是「多选、每项独立」，
 * 单选组是「值唯一、键盘 ↑↓ 在组内移动」。所以下面这条 story 特意给了
 * 键盘操作要看的两件事 —— 组级 `name` / 逐项 `aria-label`（或配 `Label`）。
 *
 * 注意 `RadioGroupItem` 与 `<Label>` 的关联走 **`htmlFor` + `id`**，
 * 不是把 Label 包在外面 —— 与 `Checkbox` 那套（可以包）不同。
 */
const meta = {
  component: RadioGroup,
  title: "UI/RadioGroup",
} satisfies Meta<typeof RadioGroup>;

export default meta;

type Story = StoryObj<typeof meta>;

/** 真实落点：输出格式三选一。 */
export const Default: Story = {
  render: (args) => (
    <RadioGroup {...args} className="gap-3" defaultValue="png">
      {[
        ["png", "PNG（无损，体积大）"],
        ["jpg", "JPG（有损，体积小）"],
        ["webp", "WebP（兼顾两者）"],
      ].map(([value, label]) => (
        <div className="flex items-center gap-2" key={value}>
          <RadioGroupItem id={`format-${value}`} value={value} />
          <Label htmlFor={`format-${value}`}>{label}</Label>
        </div>
      ))}
    </RadioGroup>
  ),
};

/** 三态并列：未选 / 选中 / 禁用（组级禁用也一并覆盖）——
 *  `data-checked` 走 `border-primary` + 内点，禁用是 `opacity-50`。 */
export const States: Story = {
  render: () => (
    <div className="flex flex-col gap-6">
      <RadioGroup className="gap-3" defaultValue="b">
        <div className="flex items-center gap-2">
          <RadioGroupItem id="state-a" value="a" />
          <Label htmlFor="state-a">未选中</Label>
        </div>
        <div className="flex items-center gap-2">
          <RadioGroupItem id="state-b" value="b" />
          <Label htmlFor="state-b">已选中</Label>
        </div>
        <div className="flex items-center gap-2">
          <RadioGroupItem disabled id="state-c" value="c" />
          <Label htmlFor="state-c">单项禁用</Label>
        </div>
      </RadioGroup>
      <RadioGroup className="gap-3" defaultValue="x" disabled>
        <div className="flex items-center gap-2">
          <RadioGroupItem id="group-disabled-x" value="x" />
          <Label htmlFor="group-disabled-x">整组禁用</Label>
        </div>
      </RadioGroup>
    </div>
  ),
};

/** 无标签（纯图标行）：这时**必须**逐项给 `aria-label`，
 *  否则组里的项没有可访问名，读屏器只会念「单选按钮」。 */
export const WithoutLabel: Story = {
  render: () => (
    <RadioGroup className="flex-row gap-3" defaultValue="1">
      {["1", "2", "3"].map((value) => (
        <RadioGroupItem aria-label={`选项 ${value}`} key={value} value={value} />
      ))}
    </RadioGroup>
  ),
};
