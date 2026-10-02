import type { Meta, StoryObj } from "@storybook/nextjs";

import { ValidationErrorList } from "~/components/ui/validation-error-list";
import type { ValidationError } from "~/lib/comfyui/validation";

/**
 * 本件是**面板式清单**（不带 ARIA 字段绑定），颜色由调用方在**外层容器**注入：
 * 画布错误面板给玫红、历史卡给红。所以这里的几张展示的是「同一份数据在不同
 * 容器里长什么样」，不是组件自己的变体。
 */
const ERRORS: ValidationError[] = [
  { nodeId: "10", classType: "KSampler", field: "cfg", message: "不是数字" },
  { nodeId: "10", classType: "KSampler", field: "steps", message: "超出范围" },
  { nodeId: "23", classType: "CLIPTextEncode", field: "text", message: "为空" },
];

const meta = {
  title: "UI/ValidationErrorList",
  component: ValidationErrorList,
  args: { errors: ERRORS },
  argTypes: {
    errors: { control: false },
  },
} satisfies Meta<typeof ValidationErrorList>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** 画布错误面板的容器色。 */
export const InCanvasPanel: Story = {
  render: (args) => (
    <div className="rounded-md border border-fuchsia-500/40 bg-fuchsia-500/5 px-3 py-2">
      <ValidationErrorList {...args} />
    </div>
  ),
};

/** 历史卡的容器色。 */
export const InHistoryCard: Story = {
  render: (args) => (
    <div className="border-destructive/40 bg-destructive/5 rounded-md border px-3 py-2">
      <ValidationErrorList {...args} />
    </div>
  ),
};

/**
 * 只有 `classType` 为空串（节点级错误）—— 那条「这一段不渲染」的分支只在
 * 这样的输入下才走得出来。
 */
export const WithoutClassType: Story = {
  args: {
    errors: [
      { nodeId: "7", classType: "", field: "seed", message: "必须是整数" },
    ],
  },
};

/** 空清单：整块**不渲染**（`null`、`undefined`、`[]` 三态同款）。
 *  画布上什么都不出现 —— 这正是它的契约，所以这张 story 的价值在 Args 面板：
 *  切 `errors` 就能看到「有错才出现」。旁边放一行说明免得被读成「story 坏了」。 */
export const Empty: Story = {
  args: { errors: [] },
  render: (args) => (
    <div className="flex flex-col gap-2">
      <p className="text-ink-faint text-xs">
        空清单（[] / null / undefined）时本件渲染 null —— 下面这行刻意留着，方便
        对照「有错才出现」。
      </p>
      <ValidationErrorList {...args} />
    </div>
  ),
};
