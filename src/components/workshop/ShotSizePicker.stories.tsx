import type { Meta, StoryObj } from "@storybook/nextjs";
import { useState } from "react";

import { ShotSizePicker } from "~/components/workshop/ShotSizePicker";
import {
  DEFAULT_SHOT_SIZE,
  shotSizeSummary,
  type ShotSizeState,
} from "~/components/workshop/shot-size-config";
import { DEFAULT_SIZE_SPEC } from "~/lib/media/size-presets";

/**
 * 镜头生图 / 生视频的尺寸选择器（比例 + 像素 [+ 倍数]）。
 *
 * 纯 props（`value` / `onChange` / `disabled` / `scene`），但它有**三个调用点**
 *（`ShotStudio` / `CharacterPortraitStudio` / 工作流库的封装测试表单），
 * 所以这组 story 要看的是「同一个控件在两种场景口径下」的形态差异：
 * `scene` 决定尺寸表用哪一份（生图走图片场景、视频走行业标准场景），
 * 因而**同一档 `clarity` 在两个场景下算出的宽高不同**。
 *
 * 与所有尺寸控件的共同口径（`lib/size-presets` 是全项目唯一表达）：
 *   · 「比例 + 分辨率」（1k / 2k / 4k，宽高按场景查表）；
 *   · 「比例 + 百万像素 + 倍数」（1M/2M/4M 之外还有一条自定义步进器）。
 *
 * 摘要那行小字调 `shotSizeSummary()`（组件自己用的那个出口）现算，不手抄
 * `832x1216` 这类数字 —— 手抄的宽高与真换算无关，改档位时 story 会继续显示旧值。
 * 默认档也从 `DEFAULT_SHOT_SIZE` 取（它就是 `DEFAULT_SIZE_SPEC` 的薄转发）。
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
  initial: ShotSizeState;
  scene?: "image" | "video";
  disabled?: boolean;
}) {
  const [value, setValue] = useState(initial);
  return (
    <div className="flex flex-col gap-2">
      <ShotSizePicker {...rest} value={value} onChange={setValue} />
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
  render: () => (
    <LivePicker initial={{ ...DEFAULT_SIZE_SPEC, clarity: "2.5M" }} />
  ),
};

/**
 * 两种 `scene` 并排：同一档 `clarity` 在生图与视频场景下**宽高不同**。
 * 这不是两条代码路径 —— 是同一份换算在不同场景尺寸表上的结果，
 * 所以两边的输入完全一样。
 */
export const TwoScenes: Story = {
  render: () => (
    <div className="flex gap-10">
      {(["image", "video"] as const).map((scene) => (
        <div key={scene} className="flex flex-col gap-2">
          <span className="text-ink-muted font-mono text-[11px]">
            scene = {scene}
          </span>
          <LivePicker
            initial={{ ...DEFAULT_SHOT_SIZE, clarity: "2k" }}
            scene={scene}
          />
        </div>
      ))}
    </div>
  ),
};

/** 禁用态（生成进行中 / 尺寸由封装层接管）。 */
export const Disabled: Story = {
  render: () => <LivePicker initial={DEFAULT_SHOT_SIZE} disabled />,
};
