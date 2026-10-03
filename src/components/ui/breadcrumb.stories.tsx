import type { Meta, StoryObj } from "@storybook/nextjs";
import { Slash } from "lucide-react";

import {
  Breadcrumb,
  BreadcrumbEllipsis,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "~/components/ui/breadcrumb";

/**
 * `ui/breadcrumb` 是「当前在哪一层」的导航基元。三件值得单看的事：
 *
 * 1. **`Breadcrumb` 是 `<nav aria-label="breadcrumb">`**（不是 `div`）——
 *    读屏器靠它把这段认成导航区；
 * 2. **最后一项必须是 `BreadcrumbPage`**（`aria-current="page"` +
 *    `aria-disabled`），不能再挂一个 `BreadcrumbLink` —— 那会让「当前位置」
 *    变成一个可点却没有去处的链接；
 * 3. **`BreadcrumbSeparator` 的默认子元素是 `ChevronRightIcon`**，
 *    但可以换成任意节点（这里换成 `/`）。
 */
const meta = {
  title: "UI/Breadcrumb",
  component: Breadcrumb,
} satisfies Meta<typeof Breadcrumb>;

export default meta;

type Story = StoryObj<typeof meta>;

/** 详情页的真实路径：首页 → 工作流库 → 当前工作流。 */
export const Default: Story = {
  render: (args) => (
    <Breadcrumb {...args}>
      <BreadcrumbList>
        <BreadcrumbItem>
          <BreadcrumbLink href="/">首页</BreadcrumbLink>
        </BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem>
          <BreadcrumbLink href="/workflows">工作流库</BreadcrumbLink>
        </BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem>
          <BreadcrumbPage>角色一致性 · 三视图</BreadcrumbPage>
        </BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>
  ),
};

/** 折叠中间层：路径太长时用 `BreadcrumbEllipsis` 吃掉中间几段
 *  —— 它自己带 `sr-only` 的「More」，读屏器不会读到一串省略号。 */
export const WithEllipsis: Story = {
  render: (args) => (
    <Breadcrumb {...args}>
      <BreadcrumbList>
        <BreadcrumbItem>
          <BreadcrumbLink href="/">首页</BreadcrumbLink>
        </BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem>
          <BreadcrumbEllipsis />
        </BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem>
          <BreadcrumbLink href="/workflows/deep">深层目录</BreadcrumbLink>
        </BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem>
          <BreadcrumbPage>当前工作流</BreadcrumbPage>
        </BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>
  ),
};

/** 自定义分隔符：`BreadcrumbSeparator` 的子节点替换默认的 `›`
 *  —— 换成一个 `/` 字形而不是图标，这条只有渲染出来才看得出。 */
export const CustomSeparator: Story = {
  render: (args) => (
    <Breadcrumb {...args}>
      <BreadcrumbList>
        <BreadcrumbItem>
          <BreadcrumbLink href="/">首页</BreadcrumbLink>
        </BreadcrumbItem>
        <BreadcrumbSeparator>
          <Slash />
        </BreadcrumbSeparator>
        <BreadcrumbItem>
          <BreadcrumbPage>设置</BreadcrumbPage>
        </BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>
  ),
};

/** 只有一层：路径就是当前页时整个列表只有一项 —— 这一档要在，
 *  否则调用处会为「首页」写一个特例分支。 */
export const SingleLevel: Story = {
  render: (args) => (
    <Breadcrumb {...args}>
      <BreadcrumbList>
        <BreadcrumbItem>
          <BreadcrumbPage>工作流库</BreadcrumbPage>
        </BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>
  ),
};
