import type { Meta, StoryObj } from "@storybook/nextjs";
import { CircleAlert, Info, TriangleAlert } from "lucide-react";

import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
} from "~/components/ui/alert";
import { Button } from "~/components/ui/button";

/**
 * 候选清单从 `Alert` 的 props 派生 —— 写法与理由与 `button.stories.tsx`
 * 一致（`cva()` 的返回值运行时没有 `.variants`，见该文件注释）。
 *
 * 本件只列 `variant` 一轴：`AlertTitle` / `AlertDescription` / `AlertAction`
 * 三个 slot 是**组合**、不是变体，列不进 `options`。
 */
type AlertVariant = NonNullable<React.ComponentProps<typeof Alert>["variant"]>;

const VARIANTS: AlertVariant[] = [
  "default",
  "destructive",
  "warning",
  "info",
  "success",
  "danger",
];

const meta = {
  title: "UI/Alert",
  component: Alert,
  args: {
    variant: "info",
    children: (
      <>
        <AlertTitle>工作流未保存</AlertTitle>
        <AlertDescription>
          关闭前请先保存，否则本次改动会丢失。
        </AlertDescription>
      </>
    ),
  },
  argTypes: {
    variant: { control: "select", options: VARIANTS },
  },
} satisfies Meta<typeof Alert>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** 六档语义色铺开——评审改 `alertVariants` 时第一眼就能看出哪一档变了。 */
export const Variants: Story = {
  render: (args) => (
    <div className="flex w-full flex-col gap-2">
      {VARIANTS.map((variant) => (
        <Alert key={variant} {...args} variant={variant}>
          <AlertTitle>{variant}</AlertTitle>
          <AlertDescription>这一档的说明文案。</AlertDescription>
        </Alert>
      ))}
    </div>
  ),
};

/** 带图标：`has-[>svg]` 那套栅格只在真的有图标时才生效。 */
export const WithIcon: Story = {
  args: {
    variant: "warning",
    children: (
      <>
        <TriangleAlert />
        <AlertTitle>端口被占用</AlertTitle>
        <AlertDescription>
          该端口已被另一个实例监听，请先关闭它再重试。
        </AlertDescription>
      </>
    ),
  },
};

/**
 * 右上角操作位：`AlertAction` 是绝对定位的，只有它出现时才给正文留出右内边距
 * （`has-data-[slot=alert-action]:pr-18`）—— 长标题 + 一个按钮才看得出。
 */
export const WithAction: Story = {
  args: {
    children: (
      <>
        <Info />
        <AlertTitle>这是一条比较长的提示标题，用来占满正文的宽度</AlertTitle>
        <AlertDescription>
          右侧的操作按钮会把正文挤窄，这条留白只在 AlertAction 出现时才生效。
        </AlertDescription>
        <AlertAction>
          <Button size="xs" variant="ghost">
            忽略
          </Button>
        </AlertAction>
      </>
    ),
  },
};

/** 错误面板的形态：图标 + 标题 + 可照做的下一步。 */
export const Attention: Story = {
  args: {
    variant: "destructive",
    children: (
      <>
        <CircleAlert />
        <AlertTitle>读取工作流失败</AlertTitle>
        <AlertDescription>
          workflow.json 不是合法的 JSON，请检查文件后重试。
        </AlertDescription>
      </>
    ),
  },
};
