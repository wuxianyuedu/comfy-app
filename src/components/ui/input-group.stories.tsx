import { Search, Send, X } from "lucide-react";
import type { Meta, StoryObj } from "@storybook/nextjs";

import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
  InputGroupText,
  InputGroupTextarea,
} from "~/components/ui/input-group";

/**
 * `ui/input-group` 是「输入框 + 前后缀」的容器族。
 *
 * 这一族有**两根彼此独立的轴**，散在两个不同的子部件上 —— 只看 `InputGroup`
 * 的 props 是看不到全貌的：
 *
 * | 轴 | 住在哪 | 档 |
 * | --- | --- | --- |
 * | `align` | `InputGroupAddon` | `inline-start` / `inline-end` / `block-start` / `block-end` |
 * | `size` | `InputGroupButton` | `xs` / `sm` / `icon-xs` / `icon-sm` |
 *
 * 而 `align` 那一轴真正改的是**容器形态**：`inline-*` 时输入框还是单行
 * （前后缀夹在两侧），`block-*` 时容器变 `flex-col`、输入框高度自动让位
 * （`has-[>[data-align=block-end]]:[&>input]:pt-3` 那一串）—— 后者是
 * 「输入框上方一行标签 + 下方一行提示」的形态，光看单项看不出来。
 *
 * 所以 story 先按 `align` 的四档分组，再单独给按钮的 `size`。
 */
type InputGroupAddonAlign = NonNullable<
  React.ComponentProps<typeof InputGroupAddon>["align"]
>;
type InputGroupButtonSize = NonNullable<
  React.ComponentProps<typeof InputGroupButton>["size"]
>;

const ALIGNS: InputGroupAddonAlign[] = [
  "inline-start",
  "inline-end",
  "block-start",
  "block-end",
];
const BUTTON_SIZES: InputGroupButtonSize[] = ["xs", "sm", "icon-xs", "icon-sm"];

const meta = {
  title: "UI/InputGroup",
  component: InputGroupAddon,
  args: { align: "inline-start" },
  /* 两根轴在这个文件里、但住在不同子部件上（`align` 在 `InputGroupAddon`、
     `size` 在 `InputGroupButton`）。`argTypes` 是「哪个清单属于哪个轴」的
     显式链接 —— 判据按**文件里的 cva 轴**核，漏掉一条就是「那一档没人验」。
     `size` 那一条的控件进不了 Args 面板（面板按 `component` 的 props 生成），
     但它必须在这里；每一档由 story `ButtonSizes` 现场铺开。 */
  argTypes: {
    align: { control: { type: "select" as const }, options: ALIGNS },
    size: { control: { type: "select" as const }, options: BUTTON_SIZES },
  } as Record<string, { control: { type: "select" }; options: string[] }>,
} satisfies Meta<typeof InputGroupAddon>;

export default meta;

type Story = StoryObj<typeof meta>;

/** 真实落点：搜索框（前缀图标 + 输入 + 尾部清除按钮）。 */
export const Default: Story = {
  render: (args) => (
    <InputGroup className="w-[24rem]">
      <InputGroupAddon {...args}>
        <Search />
      </InputGroupAddon>
      <InputGroupInput placeholder="搜索工作流…" />
      <InputGroupAddon align="inline-end">
        <InputGroupButton size="icon-xs" aria-label="清除">
          <X />
        </InputGroupButton>
      </InputGroupAddon>
    </InputGroup>
  ),
};

/** 四档 `align` 并列：前两档是 `inline-*`（单行、夹在两侧），
 *  后两档是 `block-*`（容器变 `flex-col`、输入框让出上下空间）——
 *  这四档的容器形态差别只有并排才看得出来。 */
export const Aligns: Story = {
  render: () => (
    <div className="flex w-[28rem] flex-col gap-6">
      {ALIGNS.map((align) => (
        <div key={align} className="flex flex-col gap-1.5">
          <span className="text-ink-muted font-mono text-[11px]">
            align={align}
          </span>
          <InputGroup>
            <InputGroupAddon align={align}>
              <InputGroupText>{align}</InputGroupText>
            </InputGroupAddon>
            <InputGroupInput placeholder="输入…" />
          </InputGroup>
        </div>
      ))}
    </div>
  ),
};

/** `block-start` + `block-end` 拼出的真实形态：输入框**上方**一行标签、
 *  **下方**一行提示 —— 两档同时在场时容器的 `flex-col` 与输入框的上下内边距
 *  才都生效。 */
export const BlockLayout: Story = {
  render: () => (
    <InputGroup className="w-[28rem]">
      <InputGroupAddon align="block-start">
        <InputGroupText>系统提示词</InputGroupText>
      </InputGroupAddon>
      <InputGroupTextarea
        placeholder="写在这里…"
        className="min-h-24"
        rows={4}
      />
      <InputGroupAddon align="block-end">
        <InputGroupText>支持多行，⌘↵ 提交</InputGroupText>
        <InputGroupButton size="icon-sm" aria-label="提交" className="ml-auto">
          <Send />
        </InputGroupButton>
      </InputGroupAddon>
    </InputGroup>
  ),
};

/** 按钮四档 `size` 并列（`xs` / `sm` / `icon-xs` / `icon-sm`）——
 *  两档 `icon-*` 是方的（`p-0` + 固定边长），另两档带文字内边距。 */
export const ButtonSizes: Story = {
  render: () => (
    <div className="flex w-[28rem] flex-col gap-4">
      {BUTTON_SIZES.map((size) => (
        <div key={size} className="flex flex-col gap-1.5">
          <span className="text-ink-muted font-mono text-[11px]">
            InputGroupButton size={size}
          </span>
          <InputGroup>
            <InputGroupInput placeholder="按钮 size 在这条里" />
            <InputGroupAddon align="inline-end">
              {size.startsWith("icon") ? (
                <InputGroupButton size={size} aria-label={size}>
                  <X />
                </InputGroupButton>
              ) : (
                <InputGroupButton size={size}>确定</InputGroupButton>
              )}
            </InputGroupAddon>
          </InputGroup>
        </div>
      ))}
    </div>
  ),
};

/** 三态：正常 / 禁用（整组 `opacity-50`，`has-disabled` 那条选择器管）/
 *  错误（组内任意子元素带 `aria-invalid` 时整组上色 —— 这是本件的一处
 *  与直觉不同的设计：**错误态属于容器**，不是属于输入框）。 */
export const States: Story = {
  render: () => (
    <div className="flex w-[28rem] flex-col gap-6">
      <InputGroup>
        <InputGroupAddon>
          <InputGroupText>正常</InputGroupText>
        </InputGroupAddon>
        <InputGroupInput placeholder="输入…" />
      </InputGroup>
      <InputGroup>
        <InputGroupAddon>
          <InputGroupText>禁用</InputGroupText>
        </InputGroupAddon>
        <InputGroupInput placeholder="整组一起变灰" disabled />
      </InputGroup>
      <InputGroup>
        <InputGroupAddon>
          <InputGroupText>错误</InputGroupText>
        </InputGroupAddon>
        <InputGroupInput
          placeholder="子元素带 aria-invalid 时整组上色"
          aria-invalid
        />
      </InputGroup>
    </div>
  ),
};
