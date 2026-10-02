import type { Meta, StoryObj } from "@storybook/nextjs";

import { Avatar, AvatarFallback, AvatarImage } from "~/components/ui/avatar";

/**
 * 三档尺寸是**字面量联合**（`default` / `sm` / `lg`），从 props 派生。
 *
 * 一张能用 data URL 的图就够了 —— 本件刻意**不**依赖网络：story 是「起工作台
 * 就能看」，不该额外要求一个能连外网的检出。
 *
 * 那张图**不带色值**：`currentColor` 在 `data:` URL 里不解析，而写死 hex 会撞
 * `check-theme-colors.cjs`（规范 03 §3.6.1 —— 表面色必须走 token）。这里要验的
 * 是「有图时走 `AvatarImage`、失败才落 fallback」，一个人形轮廓就够表达，
 * 顺带不引入一处新的写死色值。
 */
type AvatarSize = NonNullable<React.ComponentProps<typeof Avatar>["size"]>;

const SIZES: AvatarSize[] = ["default", "sm", "lg"];

/** 无色数据 URL：透明底 + 只描边的椭圆「头像」。 */
const PORTRAIT =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" fill="none" stroke="gray" stroke-width="4"><circle cx="32" cy="24" r="11"/><path d="M12 56a20 20 0 0 1 40 0"/></svg>',
  );

const meta = {
  title: "UI/Avatar",
  component: Avatar,
  args: { size: "default" },
  argTypes: {
    size: { control: "select", options: SIZES },
  },
} satisfies Meta<typeof Avatar>;

export default meta;

type Story = StoryObj<typeof meta>;

/** 没有 `AvatarImage` 时 `AvatarFallback` 就是内容 —— 真实的「未设置头像」档。 */
export const Default: Story = {
  render: (args) => (
    <Avatar {...args}>
      <AvatarFallback>月</AvatarFallback>
    </Avatar>
  ),
};

export const Sizes: Story = {
  render: () => (
    <div className="flex items-center gap-3">
      {SIZES.map((size) => (
        <Avatar key={size} size={size}>
          <AvatarFallback>月</AvatarFallback>
        </Avatar>
      ))}
    </div>
  ),
};

/** 有图时走 `AvatarImage`，失败才落回 fallback。 */
export const WithImage: Story = {
  render: (args) => (
    <div className="flex items-center gap-3">
      <Avatar {...args}>
        <AvatarImage src={PORTRAIT} alt="月读" />
        <AvatarFallback>月</AvatarFallback>
      </Avatar>
      <Avatar {...args}>
        <AvatarImage src="/not-a-real-image.png" alt="加载失败" />
        <AvatarFallback>失败</AvatarFallback>
      </Avatar>
    </div>
  ),
};
