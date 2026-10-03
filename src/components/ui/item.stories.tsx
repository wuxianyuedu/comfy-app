import type { Meta, StoryObj } from "@storybook/nextjs";
import { FolderOpen, HardDrive, Play, Trash2 } from "lucide-react";

import { Button } from "~/components/ui/button";
import { Icon } from "~/components/ui/icon";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemFooter,
  ItemGroup,
  ItemHeader,
  ItemMedia,
  ItemSeparator,
  ItemTitle,
} from "~/components/ui/item";

/**
 * `ui/item` 是「列表项 = 前缀 media + 主内容 + 尾部动作」的基元族。
 *
 * **两根轴都在 `Item` 本体上**（`variant` × `size`），其中 `size=xs` 还会
 * 顺手改子部件：`ItemDescription` 变小一号、`ItemMedia` 的 image 档从
 * `size-10` 收到 `size-6`，以及 `Item` 自己的内边距在 `dropdown-menu-content`
 * 里归零 —— 也就是说 `size` 是「这一项住在哪」的语义，不只是尺寸。
 *
 * `ItemMedia` 自己还有第三根轴（`default` / `icon` / `image`）。
 * 三条轴的枚举全部从 props 派生（规范 16 §16.2.3.4）。
 */
type ItemVariant = NonNullable<React.ComponentProps<typeof Item>["variant"]>;
type ItemSize = NonNullable<React.ComponentProps<typeof Item>["size"]>;
type ItemMediaVariant = NonNullable<
  React.ComponentProps<typeof ItemMedia>["variant"]
>;

const VARIANTS: ItemVariant[] = ["default", "outline", "muted"];
const SIZES: ItemSize[] = ["default", "sm", "xs"];
const MEDIA_KINDS: ItemMediaVariant[] = ["default", "icon", "image"];

const meta = {
  title: "UI/Item",
  component: Item,
  args: { variant: "outline", size: "default" },
  argTypes: {
    variant: { control: "select", options: VARIANTS },
    size: { control: "select", options: SIZES },
  },
} satisfies Meta<typeof Item>;

export default meta;

type Story = StoryObj<typeof meta>;

/** 真实落点：工作流列表的一行（`ItemGroup` + 分隔线 + 尾部动作）。 */
export const Default: Story = {
  render: (args) => (
    <ItemGroup className="w-[30rem]">
      <Item {...args}>
        <ItemMedia variant="icon">
          <FolderOpen />
        </ItemMedia>
        <ItemContent>
          <ItemTitle>角色一致性 · 三视图</ItemTitle>
          <ItemDescription>27 个节点 · 昨天更新</ItemDescription>
        </ItemContent>
        <ItemActions>
          <Button size="icon-sm" variant="ghost" aria-label="运行">
            <Play />
          </Button>
          <Button size="icon-sm" variant="ghost" aria-label="删除">
            <Trash2 />
          </Button>
        </ItemActions>
      </Item>
      <ItemSeparator />
      <Item {...args} variant="muted">
        <ItemMedia variant="icon">
          <HardDrive />
        </ItemMedia>
        <ItemContent>
          <ItemTitle>首帧 → 逐镜生成</ItemTitle>
          <ItemDescription>41 个节点 · 3 天前</ItemDescription>
        </ItemContent>
      </Item>
    </ItemGroup>
  ),
};

/** 三档 `variant`：`default` 无边框、`outline` 带描边、`muted` 半透明底
 *  —— 三档的区别只在边框与底色，行高由 `size` 管。 */
export const Variants: Story = {
  render: () => (
    <div className="flex w-[30rem] flex-col gap-3">
      {VARIANTS.map((variant) => (
        <Item key={variant} variant={variant} size="default">
          <ItemContent>
            <ItemTitle>variant={variant}</ItemTitle>
            <ItemDescription>底色与边框是这三档唯一的差别</ItemDescription>
          </ItemContent>
        </Item>
      ))}
    </div>
  ),
};

/**
 * 三档 `size` 并列。`xs` 是**为浮层里的列表项准备的**：内边距更小，
 * `ItemDescription` 降一号字，`ItemMedia` 的 image 档收到 `size-6`
 * —— 它不只是缩放，是「这一项住在下拉菜单里」这个语义。
 */
export const Sizes: Story = {
  render: () => (
    <div className="flex w-[30rem] flex-col gap-4">
      {SIZES.map((size) => (
        <Item key={size} size={size} variant="outline">
          <ItemMedia variant="icon">
            <FolderOpen />
          </ItemMedia>
          <ItemContent>
            <ItemTitle>size={size}</ItemTitle>
            <ItemDescription>
              {size === "xs"
                ? "给浮层里的列表项用（更紧、字号更小）"
                : "常规列表项"}
            </ItemDescription>
          </ItemContent>
        </Item>
      ))}
    </div>
  ),
};

/** 三档 `ItemMedia`：`default` 裸容器、`icon` 把 `svg` 归一成 `size-4`、
 *  `image` 给 `size-10`（`size=sm` 时 8、`xs` 时 6）圆形裁切。 */
export const MediaVariants: Story = {
  render: () => (
    <div className="flex w-[30rem] flex-col gap-4">
      {MEDIA_KINDS.map((variant) => (
        <Item key={variant} variant="outline">
          <ItemMedia variant={variant}>
            <Icon name="image" />
          </ItemMedia>
          <ItemContent>
            <ItemTitle>ItemMedia variant={variant}</ItemTitle>
            <ItemDescription>这档决定前缀占多大、图标缩不缩</ItemDescription>
          </ItemContent>
        </Item>
      ))}
    </div>
  ),
};

/** 头尾 slot：`ItemHeader` / `ItemFooter` 用 `basis-full` 占满整行，
 *  所以它们会把内容挤到第二行 —— 常见于「标题一行、正文一行、按钮一行」
 *  的历史任务卡。 */
export const WithHeaderAndFooter: Story = {
  render: (args) => (
    <Item {...args} className="w-[30rem]">
      <ItemHeader>
        <ItemTitle>运行 #1043</ItemTitle>
        <ItemDescription>12:04:31</ItemDescription>
      </ItemHeader>
      <ItemContent>
        <ItemDescription>
          提示词：a lone lighthouse on a basalt cliff …
        </ItemDescription>
      </ItemContent>
      <ItemFooter>
        <ItemDescription>耗时 42.8s</ItemDescription>
        <Button size="xs" variant="ghost">
          查看产物
        </Button>
      </ItemFooter>
    </Item>
  ),
};
