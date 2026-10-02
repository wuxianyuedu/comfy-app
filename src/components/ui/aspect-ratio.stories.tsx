import type { Meta, StoryObj } from "@storybook/nextjs";

import { AspectRatio } from "~/components/ui/aspect-ratio";
import { fixed } from "~/lib/number-format";

/**
 * 比例来自 `ratio` 这个**数字**（`16 / 9` 这种算式写法才是它存在的意义：
 * 写 `aspect-video` 就不能按数据算比例了）。样式落在 CSS 变量 `--ratio` 上，
 * 所以这一屏也在核「变量真的被 tailwind 读到了」。
 */
const meta = {
  title: "UI/AspectRatio",
  component: AspectRatio,
  args: { ratio: 16 / 9, className: "bg-subtle w-72 rounded-lg" },
  argTypes: {
    ratio: { control: { type: "number", step: 0.1 } },
  },
} satisfies Meta<typeof AspectRatio>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** 三档常见比例 + 一档从数据算出来的比例（数字按精度成串走
 *  `~/lib/number-format`，不在这里自己写 `toFixed` —— 规范 16 §16.2.3 P50）。 */
export const Ratios: Story = {
  render: () => (
    <div className="flex flex-wrap items-end gap-4">
      {[16 / 9, 4 / 3, 1, 3 / 4].map((ratio) => (
        <AspectRatio
          key={ratio}
          ratio={ratio}
          className="bg-subtle border-border flex w-40 items-center justify-center rounded-lg border border-dashed text-xs"
        >
          {fixed(ratio, 2)}
        </AspectRatio>
      ))}
    </div>
  ),
};

/** 真实落点：媒体缩略图的占位块（图还没到时先按比例撑住布局，避免跳动）。 */
export const MediaSlot: Story = {
  render: () => (
    <AspectRatio
      ratio={832 / 1216}
      className="bg-subtle border-border w-48 rounded-lg border border-dashed"
    >
      <div className="text-ink-faint grid h-full place-items-center text-xs">
        832 × 1216
      </div>
    </AspectRatio>
  ),
};
