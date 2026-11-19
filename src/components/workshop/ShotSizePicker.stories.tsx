import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useState } from "react";

import { ShotSizePicker } from "~/components/workshop/ShotSizePicker";
import {
  DEFAULT_SHOT_SIZE,
  shotSizeSummary,
  type ShotSizeState,
} from "~/components/workshop/shot-size-config";
import { DEFAULT_SIZE_SPEC } from "~/lib/media/size-presets";

/**
 * 镜头生图 / 生视频的尺寸选择器（比例 + 像素 [+ 倍数]）。纯 props、三个调用点，要看「同一控件在两种场景口径下」的形态差异：`scene` 决定尺寸表（生图走图片
 * 场景、视频走行业标准场景），同一档 `clarity` 两场景算出的宽高不同。摘要小字调 `shotSizeSummary()` 现算、默认档从 `DEFAULT_SHOT_SIZE` 取，都不手抄
 *（手抄值与真换算无关，改档位时 story 会继续显示旧值）。
 */
const meta = {
  title: "Workshop/ShotSizePicker",
  component: ShotSizePicker,
  args: { value: DEFAULT_SHOT_SIZE, onChange: () => undefined },
  argTypes: {
    scene: { control: { type: "select" }, options: ["image", "video"] },
    disabled: { control: { type: "boolean" } },
  },
} satisfies Meta<typeof ShotSizePicker>;

export default meta;

type Story = StoryObj<typeof meta>;

/** 受控适配：切档位要真发生（宽高与摘要都是派生量），所以 story 自己持状态。 */
function LivePicker({
  initial,
  ...rest
}: {
  disabled?: boolean;
  initial: ShotSizeState;
  scene?: "image" | "video";
}) {
  const [value, setValue] = useState(initial);
  return (
    <div className="flex flex-col gap-2">
      <ShotSizePicker {...rest} onChange={setValue} value={value} />
      <p className="text-ink-muted font-mono text-[11px]">
        {JSON.stringify(value)} → {shotSizeSummary(value)}
      </p>
    </div>
  );
}

/** 默认档（`DEFAULT_SHOT_SIZE` = `DEFAULT_SIZE_SPEC` 的薄转发）。 */
export const Default: Story = {
  render: () => <LivePicker initial={DEFAULT_SHOT_SIZE} />,
};

/** 自由百万像素档：`clarity` 是 `"2.5M"` 这类档位之外的值，追加「倍数」一段。 */
export const CustomMegapixels: Story = {
  render: () => <LivePicker initial={{ ...DEFAULT_SIZE_SPEC, clarity: "2.5M" }} />,
};

/**
 * 两种 `scene` 并排：同一档 `clarity` 在生图与视频场景下**宽高不同**。
 * 这不是两条代码路径 —— 是同一份换算在不同场景尺寸表上的结果，
 * 所以两边的输入完全一样。
 */
export const TwoScenes: Story = {
  render: () => (
    /* SAFETY: 类型断言已复核 */
    <div className="flex gap-10">
      {(["image", "video"] as const).map((scene) => (
        <div className="flex flex-col gap-2" key={scene}>
          <span className="text-ink-muted font-mono text-[11px]">scene = {scene}</span>
          <LivePicker initial={{ ...DEFAULT_SHOT_SIZE, clarity: "2k" }} scene={scene} />
        </div>
      ))}
    </div>
  ),
};

/** 禁用态（生成进行中 / 尺寸由封装层接管）。 */
export const Disabled: Story = {
  render: () => <LivePicker disabled initial={DEFAULT_SHOT_SIZE} />,
};
