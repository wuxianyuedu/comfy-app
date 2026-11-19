import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { Button } from "~/components/ui/button";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "~/components/ui/hover-card";

/**
 * `ui/hover-card` 是 base-ui PreviewCard 的封装（可交互的富内容卡片）。与 tooltip 的分工：
 * tooltip 是简短解释；本件内的链接可点、鼠标移入不关闭（有 `openDelay` / `closeDelay`）。
 * 定位读 `useOverlayBoundary()`：可用区域 = 视口减去应用级标题行（壳态才有）。⚠️ 需悬停且有延迟。
 */
const meta = {
  title: "UI/HoverCard",
  component: HoverCard,
} satisfies Meta<typeof HoverCard>;

export default meta;

type Story = StoryObj<typeof meta>;

/** 真实落点：悬停模型名看它的元信息（大小 / 来源 / 上次使用）。 */
export const Default: Story = {
  render: () => (
    <HoverCard>
      <HoverCardTrigger render={<Button variant="link" />}>
        sd_xl_base_1.0.safetensors
      </HoverCardTrigger>
      <HoverCardContent>
        <div className="flex flex-col gap-1 text-sm">
          <span className="font-medium">基础模型</span>
          <span className="text-ink-muted">6.9 GB · 本地路径 D:/ComfyUI/models</span>
          <span className="text-ink-muted">上次使用：昨天 13:02</span>
        </div>
      </HoverCardContent>
    </HoverCard>
  ),
};

/** **可交互**是这一档的重点：卡片里放一个链接 / 按钮，鼠标从触发器挪进卡片
 *  时卡片**不会关**（否则「点进去」这件事根本做不到）。这一条也是本件与
 *  tooltip 最实质的差别。 */
export const InteractiveContent: Story = {
  render: () => (
    <HoverCard>
      <HoverCardTrigger render={<Button variant="outline" />}>悬停后挪进卡片里</HoverCardTrigger>
      <HoverCardContent>
        <div className="flex flex-col gap-2 text-sm">
          <span className="font-medium">角色一致性 · 三视图</span>
          <p className="text-ink-muted">鼠标挪进来时卡片不会消失，所以下面这个按钮点得到。</p>
          <Button size="xs" variant="outline">
            打开工作流
          </Button>
        </div>
      </HoverCardContent>
    </HoverCard>
  ),
};

/** 四个方向：`side` 只表达「想开在哪边」，撞到视口边界时由基元翻转
 *  —— 四条并排同时悬停很难，逐条试更实际。 */
export const Sides: Story = {
  render: () => (
    /* SAFETY: 类型断言已复核 */
    <div className="flex items-center gap-4">
      {(["top", "right", "bottom", "left"] as const).map((side) => (
        <HoverCard key={side}>
          <HoverCardTrigger render={<Button size="sm" variant="outline" />}>
            side={side}
          </HoverCardTrigger>
          <HoverCardContent side={side}>
            <p className="text-sm">开在 {side} 这一侧</p>
          </HoverCardContent>
        </HoverCard>
      ))}
    </div>
  ),
};
