import { Info, Trash2 } from "lucide-react";
import type { Meta, StoryObj } from "@storybook/nextjs";

import { Button } from "~/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "~/components/ui/tooltip";

/** `ui/tooltip` 是 base-ui 的悬停提示基座，比裸基元多两处只有真悬停 / 贴边才看得出的口径：① `delay` 定档 300ms
 *（基元默认 600），贴近原生 `title=`，免得划过密集工具条时连弹；② `TOOLTIP_COLLISION_PADDING = 12`，基元只留 5px，
 * 贴边控件上气泡紧贴窗口边（实测右边缘 1435/1440）。日常用法用 `hint` 收口；⚠️ 需悬停才出现，贴边请拖窄画布。 */
const meta = {
  title: "UI/Tooltip",
  component: Tooltip,
} satisfies Meta<typeof Tooltip>;

export default meta;

type Story = StoryObj<typeof meta>;

/** 最基础：图标按钮 + 一行解释。 */
export const Default: Story = {
  render: () => (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger render={<Button size="icon-sm" variant="ghost" />}>
          <Info />
          <span className="sr-only">说明</span>
        </TooltipTrigger>
        <TooltipContent>这段会写进工作流模板</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  ),
};

/** 密集工具条：连排四个图标按钮，鼠标划过时看**300ms** 的节奏
 *  （基元默认 600 会明显更粘）。 */
export const InToolbar: Story = {
  render: () => (
    <TooltipProvider>
      <div className="flex items-center gap-1 rounded-lg border p-1">
        {["运行", "停止", "清空", "删除"].map((label, index) => (
          <Tooltip key={label}>
            <TooltipTrigger
              render={<Button size="icon-sm" variant={index === 3 ? "danger" : "ghost"} />}
            >
              <Trash2 />
              <span className="sr-only">{label}</span>
            </TooltipTrigger>
            <TooltipContent>{label}</TooltipContent>
          </Tooltip>
        ))}
      </div>
    </TooltipProvider>
  ),
};

/**
 * 贴边：把这段放到画布**最右上角**（`self-start` + `justify-end`），
 * 悬停看气泡右边缘与画布边缘之间那 12px —— 去掉
 * `collisionPadding` 默认值时会紧贴到只剩 5px，就是这条口径要修的形态。
 */
export const NearEdge: Story = {
  parameters: { layout: "padded" },
  render: () => (
    <TooltipProvider>
      <div className="flex justify-end">
        <Tooltip>
          <TooltipTrigger render={<Button variant="outline" />}>贴右上角</TooltipTrigger>
          <TooltipContent>一段比较长的文案，用来看气泡贴边时右边留多少</TooltipContent>
        </Tooltip>
      </div>
    </TooltipProvider>
  ),
};

/** 四个方向：`side` 只表达「想开在哪边」，撞边时由基元的 `flip` 翻过去。 */
export const Sides: Story = {
  render: () => (
    /* SAFETY: 类型断言已复核 */
    <TooltipProvider>
      <div className="flex items-center gap-3">
        {(["top", "right", "bottom", "left"] as const).map((side) => (
          <Tooltip key={side}>
            <TooltipTrigger render={<Button size="sm" variant="outline" />}>{side}</TooltipTrigger>
            <TooltipContent side={side}>开在 {side}</TooltipContent>
          </Tooltip>
        ))}
      </div>
    </TooltipProvider>
  ),
};
