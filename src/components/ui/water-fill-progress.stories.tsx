import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { WaterFillProgress } from "~/components/ui/water-fill-progress";

/**
 * 「水逐渐装满」的进度覆盖层：整层绝对定位 `inset-0`，要放在 `relative` 容器里 —— 本件每张都用同一块底色方框当容器。
 * 水层用 `translateY` 而不是 `height`（只触发合成层），`pct` 由 `~/lib/clamp` 夹取 —— 越界输入在这一屏看得到。
 */
const meta = {
  title: "UI/WaterFillProgress",
  component: WaterFillProgress,
  args: { progress: 45 },
  argTypes: {
    progress: { control: { type: "range", min: 0, max: 100 } },
  },
} satisfies Meta<typeof WaterFillProgress>;

export default meta;

type Story = StoryObj<typeof meta>;

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-subtle border-border relative h-40 w-64 overflow-hidden rounded-xl border border-dashed">
      {children}
    </div>
  );
}

export const Default: Story = {
  render: (args) => (
    <Frame>
      <WaterFillProgress {...args} />
    </Frame>
  ),
};

/** 四档水位：0 / 低 / 高 / 满 —— 水面（那条 6px 正弦波）在四档都骑在水位上。 */
export const Levels: Story = {
  render: () => (
    <div className="flex items-center gap-4">
      {[0, 25, 78, 100].map((progress) => (
        <Frame key={progress}>
          <WaterFillProgress progress={progress} />
        </Frame>
      ))}
    </div>
  ),
};

/** 越界输入被夹取（`-20` → 0%、`180` → 100%），不会溢出成方角或负高度。 */
export const ClampedInput: Story = {
  render: () => (
    <div className="flex items-center gap-4">
      <Frame>
        <WaterFillProgress progress={-20} />
      </Frame>
      <Frame>
        <WaterFillProgress progress={180} />
      </Frame>
    </div>
  ),
};

/** tqdm 式明细（ISSUE #4908）：步数 / 速度 / 已用 / 预估剩余。
 *  文字由 `describeSampleProgress` 算好传来；拿不到的行不显示。 */
export const WithDetail: Story = {
  render: () => (
    <div className="flex items-center gap-4">
      <Frame>
        <WaterFillProgress
          detail={{
            etaText: "09:18",
            elapsedText: "00:42",
            pct: 7,
            rateText: "13.17 it/s",
            stepsText: "553/8196",
          }}
          progress={7}
        />
      </Frame>
      {/* 没有步数帧（comfy-cli 事件源）与没到剩余可算区间时的降级形态。 */}
      <Frame>
        <WaterFillProgress
          detail={{ etaText: null, elapsedText: "00:05", pct: 0, rateText: null, stepsText: null }}
          progress={0}
        />
      </Frame>
    </div>
  ),
};
