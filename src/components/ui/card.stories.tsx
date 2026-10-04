import type { Meta, StoryObj } from "@storybook/nextjs";
import { MoreHorizontal } from "lucide-react";

import { Button } from "~/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";

/**
 * `ui/card` 是「有边框的独立内容块」的基元。它的形态全由**有哪些 slot**
 * 决定（不是变体）：`CardHeader` 用 `has-data-[slot=card-action]` / `has-data-
 * [slot=card-description]` 改栅格，`Card` 本体用 `has-data-[slot=card-footer]`
 * 把下内边距收掉 —— 所以下面按「拼了哪几件」分组，而不是按 props 分组。
 *
 * 两个 slot 的副作用只有并排看才明显：
 * - 有 `CardAction` → Header 变 `grid-cols-[1fr_auto]`，标题与操作位同行；
 * - 有 `CardFooter` → Card 本体的 `pb-0`，让页脚贴住底边。
 *
 * `size` 是**唯一那根轴**（`default` / `sm`），它改的是 `--card-spacing`
 * 这个 CSS 变量 —— 所有内边距都从它派生。枚举从 props 派生（规范 16 §16.2.3.4）。
 */
type CardSize = NonNullable<React.ComponentProps<typeof Card>["size"]>;

const SIZES: CardSize[] = ["default", "sm"];

const meta = {
  title: "UI/Card",
  component: Card,
} satisfies Meta<typeof Card>;

export default meta;

type Story = StoryObj<typeof meta>;

/** 最小可用组合：标题 + 说明 + 正文。 */
export const Default: Story = {
  render: (args) => (
    <Card {...args} className="w-88">
      <CardHeader>
        <CardTitle>输出设置</CardTitle>
        <CardDescription>这些取值会写进工作流模板。</CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-ink-muted">
          默认 1024×1024，节点上的同名字段以节点为准。
        </p>
      </CardContent>
    </Card>
  ),
};

/** 带操作位：`CardAction` 出现后 Header 变成两列栅格，标题与 `⋯` 同行
 *  （`col-start-2 row-span-2` 让它跨两行，说明文字仍留在第一列）。 */
export const WithAction: Story = {
  render: (args) => (
    <Card {...args} className="w-88">
      <CardHeader>
        <CardTitle>角色一致性 · 三视图</CardTitle>
        <CardDescription>27 个节点 · 昨天更新</CardDescription>
        <CardAction>
          <Button size="icon-sm" variant="ghost" aria-label="更多操作">
            <MoreHorizontal />
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        <p className="text-ink-muted">用同一张参考图生成正/侧/背三视图。</p>
      </CardContent>
    </Card>
  ),
};

/** 带页脚：`Card` 本体收到 `has-data-[slot=card-footer]`，下内边距归零 ——
 *  页脚自己带 `bg-muted/50` 与上边框，贴住卡片底边才不露一条缝。 */
export const WithFooter: Story = {
  render: (args) => (
    <Card {...args} className="w-88">
      <CardHeader>
        <CardTitle>删除这个项目？</CardTitle>
        <CardDescription>项目产物与运行记录会一起删掉。</CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-ink-muted">此操作不可撤销。</p>
      </CardContent>
      <CardFooter className="justify-end gap-2">
        <Button variant="ghost">取消</Button>
        <Button variant="danger">删除</Button>
      </CardFooter>
    </Card>
  ),
};

/** 两档 `size` 并列：`sm` 把 `--card-spacing` 从 4 收到 3，所有内边距一起变
 *  —— 这是 `Card` 里唯一一处「一个变量管到底」的设计，值得单看。 */
export const Sizes: Story = {
  render: () => (
    <div className="flex items-start gap-6">
      {SIZES.map((size) => (
        <Card key={size} size={size} className="w-[18rem]">
          <CardHeader>
            <CardTitle>size={size}</CardTitle>
            <CardDescription>内边距由 --card-spacing 给</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-ink-muted">
              default 是 spacing(4)，sm 是 spacing(3)。
            </p>
          </CardContent>
        </Card>
      ))}
    </div>
  ),
};
