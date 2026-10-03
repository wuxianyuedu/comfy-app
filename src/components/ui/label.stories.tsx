import type { Meta, StoryObj } from "@storybook/nextjs";

import { Checkbox } from "~/components/ui/checkbox";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";

/**
 * `ui/label` 是原生 `<label>` 的薄封装，三件事值得单独看：
 *
 * 1. **`htmlFor` 关联**：点标签等于点控件（这里用 `<Input>` 现场验）；
 * 2. **`flex items-center gap-2`**：所以「标签 + 控件」并排时不必自己排 ——
 *    这也解释了为什么它有时显得比裸 `<label>` 宽；
 * 3. **`peer-disabled:*`**：兄弟控件禁用时标签一起变灰（`peer` 是同级的
 *    「状态来源」，不是子元素）。
 */
const meta = {
  title: "UI/Label",
  component: Label,
  args: { children: "模型名称" },
} satisfies Meta<typeof Label>;

export default meta;

type Story = StoryObj<typeof meta>;

/** 最常用：`htmlFor` 指向输入框，点文字也聚焦。 */
export const Default: Story = {
  render: (args) => (
    <div className="flex w-[20rem] flex-col gap-1.5">
      <Label {...args} htmlFor="label-demo-input" />
      <Input id="label-demo-input" placeholder="例如 sd_xl_base_1.0" />
    </div>
  ),
};

/** 并排：`Label` 自带 `flex items-center gap-2`，包住勾选框时整行可点
 *  （`htmlFor` 指向勾选框即可）。 */
export const WithControlInline: Story = {
  render: () => (
    <div className="flex flex-col gap-3">
      <Label htmlFor="label-check-a">
        <Checkbox id="label-check-a" defaultChecked /> 本地模型
      </Label>
      <Label htmlFor="label-check-b">
        <Checkbox id="label-check-b" /> 工作流库
      </Label>
    </div>
  ),
};

/** 禁用态：`peer-disabled:*` 读的是**同级** `peer` 的 `:disabled` —— 所以
 *  禁用时标签自己变灰，不必调用处再传一个 `disabled` 进来。 */
export const DisabledPeer: Story = {
  render: () => (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Input id="label-peer-disabled" disabled className="peer" />
        <Label htmlFor="label-peer-disabled">同时写出元数据</Label>
      </div>
      <div className="flex items-center gap-2">
        <Input id="label-peer-enabled" className="peer" />
        <Label htmlFor="label-peer-enabled">这一行是对照（可用）</Label>
      </div>
    </div>
  ),
};
