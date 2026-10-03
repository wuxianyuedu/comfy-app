import { AlignCenter, AlignLeft, AlignRight, Bold, Italic } from "lucide-react";
import type { Meta, StoryObj } from "@storybook/nextjs";

import { ToggleGroup, ToggleGroupItem } from "~/components/ui/toggle-group";

/**
 * `ui/toggle-group` 是**一组互斥 / 可多选的开关按钮**：它把 `toggleVariants`
 * 的 `variant` / `size` 经 context 传给每个 `ToggleGroupItem`
 * （item 自己**不**接这两轴，只接 `value`）—— 所以本 story 的枚举清单挂在整个
 * 组上，而不是逐项传。
 *
 * 三根轴都在组上：
 * - `variant` × `size`：与 `ui/toggle` 同源，走 context 下发；
 * - `orientation`：横排 / 竖排（`flex-col`）；
 * - `spacing`（数字）：项之间的间隙（像素），`0` 就是紧贴的一整条分段控件。
 *
 * **多选还是单选由 `ToggleGroup` 的 `value` / `defaultValue` 形状决定**
 * （数组 = 多选），这是这一族最容易写错的一处 —— 两条 story 并排给出来。
 */
type ToggleGroupVariant = NonNullable<
  React.ComponentProps<typeof ToggleGroup>["variant"]
>;
type ToggleGroupSize = NonNullable<
  React.ComponentProps<typeof ToggleGroup>["size"]
>;
type ToggleGroupOrientation = NonNullable<
  React.ComponentProps<typeof ToggleGroup>["orientation"]
>;

const VARIANTS: ToggleGroupVariant[] = ["default", "outline"];
const SIZES: ToggleGroupSize[] = ["default", "sm", "lg"];
const ORIENTATIONS: ToggleGroupOrientation[] = ["horizontal", "vertical"];

const meta = {
  title: "UI/ToggleGroup",
  component: ToggleGroup,
  args: {
    variant: "default",
    size: "default",
    orientation: "horizontal",
    spacing: 2,
  },
  argTypes: {
    variant: { control: "select", options: VARIANTS },
    size: { control: "select", options: SIZES },
    orientation: { control: "select", options: ORIENTATIONS },
  },
} satisfies Meta<typeof ToggleGroup>;

export default meta;

type Story = StoryObj<typeof meta>;

/** 单选（对齐方式）：`value` 恒是数组，**互斥由 `multiple` 缺省 false 给**
 *  —— 这是 base-ui 的口径（与 Radix 那种「传字符串就单选」不同）。 */
export const SingleSelect: Story = {
  render: (args) => (
    <ToggleGroup {...args} defaultValue={["left"]} aria-label="对齐方式">
      <ToggleGroupItem value="left" aria-label="左对齐">
        <AlignLeft />
      </ToggleGroupItem>
      <ToggleGroupItem value="center" aria-label="居中">
        <AlignCenter />
      </ToggleGroupItem>
      <ToggleGroupItem value="right" aria-label="右对齐">
        <AlignRight />
      </ToggleGroupItem>
    </ToggleGroup>
  ),
};

/** 多选（文字样式）：`multiple` —— 同一组可以同时按下多个。
 *  与上一档的**唯一差别就是这个布尔**（`value` 两档都是数组）。 */
export const MultiSelect: Story = {
  render: (args) => (
    <ToggleGroup
      {...args}
      multiple
      defaultValue={["bold"]}
      aria-label="文字样式"
    >
      <ToggleGroupItem value="bold" aria-label="加粗">
        <Bold />
      </ToggleGroupItem>
      <ToggleGroupItem value="italic" aria-label="斜体">
        <Italic />
      </ToggleGroupItem>
    </ToggleGroup>
  ),
};

/** `variant` × `size` 铺开：两轴都经 context 下发给每一项 ——
 *  item 自己不接这两个 prop。 */
export const VariantsAndSizes: Story = {
  render: (args) => (
    <div className="flex flex-col gap-4">
      {VARIANTS.map((variant) => (
        <div key={variant} className="flex items-center gap-4">
          {SIZES.map((size) => (
            <ToggleGroup
              {...args}
              key={size}
              variant={variant}
              size={size}
              defaultValue={["a"]}
              aria-label={`${variant} / ${size}`}
            >
              <ToggleGroupItem value="a">{variant}</ToggleGroupItem>
              <ToggleGroupItem value="b">{size}</ToggleGroupItem>
            </ToggleGroup>
          ))}
        </div>
      ))}
    </div>
  ),
};

/** `orientation` 两档：竖排时组变 `flex-col`（`data-orientation` 驱动）。 */
export const Orientations: Story = {
  render: (args) => (
    <div className="flex items-start gap-8">
      {ORIENTATIONS.map((orientation) => (
        <ToggleGroup
          {...args}
          key={orientation}
          orientation={orientation}
          variant="outline"
          defaultValue={["a"]}
          aria-label={`朝向 ${orientation}`}
        >
          <ToggleGroupItem value="a">上</ToggleGroupItem>
          <ToggleGroupItem value="b">中</ToggleGroupItem>
          <ToggleGroupItem value="c">下</ToggleGroupItem>
        </ToggleGroup>
      ))}
    </div>
  ),
};

/** `spacing` 两档：`2`（默认，项之间留 2px 缝）/ `0`（紧贴成一条分段控件）
 *  —— 后者是「左侧/右侧」这类二选一的常见形态。 */
export const Spacing: Story = {
  render: (args) => (
    <div className="flex flex-col gap-4">
      {[2, 0].map((spacing) => (
        <ToggleGroup
          {...args}
          key={spacing}
          spacing={spacing}
          variant="outline"
          defaultValue={["left"]}
          aria-label={`spacing=${String(spacing)}`}
        >
          <ToggleGroupItem value="left">左侧</ToggleGroupItem>
          <ToggleGroupItem value="right">右侧</ToggleGroupItem>
        </ToggleGroup>
      ))}
    </div>
  ),
};
