import { Info, Trash2 } from "lucide-react";
import type { Meta, StoryObj } from "@storybook/nextjs";

import { Button } from "~/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "~/components/ui/tooltip";

/**
 * `ui/tooltip` 是 base-ui 的悬停提示基座。它比裸基元多出**两处项目特有的口径**，
 * 两处都只有真悬停 / 贴边时才看得出：
 *
 * 1. **`delay` 显式定档 300ms**（`tooltip.tsx` 里写死）—— 基元默认是 600，
 *    这里贴近原生 `title=` 的出现速度，免得鼠标划过密集工具条时一串浮层连弹；
 * 2. **`TOOLTIP_COLLISION_PADDING = 12`**：气泡与窗口边缘之间留 12px。
 *    基元默认只留 5px，在右上角 / 右下角这类贴边控件上气泡会**紧贴窗口边**
 *    （实测右边缘落在 1435/1440），长文案读起来像被裁掉。
 *    基元自己的 `shift` 确实把它夹回来了 —— 问题是**夹得太靠边**。
 *
 * 项目里的日常用法**不是**这一组三件套，而是 `~/components/ui/hint`
 * （它把「Trigger 必用 render 接管子元素」这件事收了一处，并处理了
 * 纯图标按钮的可访问名）。本 story 给的是基座形态 + 那两处口径的现场。
 *
 * ⚠️ 悬停提示在画布上要点一下 / 悬停才出现；贴边那条请**把画布拖窄**再看。
 */
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
              render={
                <Button
                  size="icon-sm"
                  variant={index === 3 ? "danger" : "ghost"}
                />
              }
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
          <TooltipTrigger render={<Button variant="outline" />}>
            贴右上角
          </TooltipTrigger>
          <TooltipContent>
            一段比较长的文案，用来看气泡贴边时右边留多少
          </TooltipContent>
        </Tooltip>
      </div>
    </TooltipProvider>
  ),
};

/** 四个方向：`side` 只表达「想开在哪边」，撞边时由基元的 `flip` 翻过去。 */
export const Sides: Story = {
  render: () => (
    <TooltipProvider>
      <div className="flex items-center gap-3">
        {(["top", "right", "bottom", "left"] as const).map((side) => (
          <Tooltip key={side}>
            <TooltipTrigger render={<Button variant="outline" size="sm" />}>
              {side}
            </TooltipTrigger>
            <TooltipContent side={side}>开在 {side}</TooltipContent>
          </Tooltip>
        ))}
      </div>
    </TooltipProvider>
  ),
};
