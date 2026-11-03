import type { Meta, StoryObj } from "@storybook/nextjs";

import {
  CanvasProgressIndicator,
  stageProgressPct,
} from "~/components/studio/project-canvas/CanvasProgressIndicator";
import { PRODUCTION_STAGES, normalizeProductionProgress } from "~/lib/production/progress";

/**
 * 画布侧「生产进度」指示器 —— **纯展示**，入参一份 `ProductionProgress`（`{ stage, rendered }`，
 * 持久来源是 `production` 行 `progress` 列，工坊与画布共读）。百分比逐条调 `stageProgressPct()`
 * 现算；`rendered` 不参与阶段序，直接 100% 且文案「已合成」。真机是左上角绝对定位，story 需相对容器。
 */
const meta = {
  title: "Studio/CanvasProgressIndicator",
  component: CanvasProgressIndicator,
  args: { progress: { stage: "shots", rendered: false } },
  argTypes: {
    progress: {
      control: { type: "object" },
      description: "阶段游标 + 是否已合成（持久来源的投影）",
    },
  },
} satisfies Meta<typeof CanvasProgressIndicator>;

export default meta;

type Story = StoryObj<typeof meta>;

/** 中途态：游标在「镜头生图」。 */
export const Midway: Story = {};

/**
 * 六段游标逐档：每一档的百分比都由 `stageProgressPct()` **现算**，
 * 不是手抄的常数 —— 阶段序一变，这里跟着变。
 */
export const EachStage: Story = {
  render: () => (
    <div className="grid grid-cols-2 gap-4">
      {PRODUCTION_STAGES.map((stage) => (
        <div className="flex flex-col gap-1" key={stage}>
          <span className="text-ink-muted font-mono text-[11px]">
            stage = {stage} · {stageProgressPct({ stage, rendered: false })}%
          </span>
          <div className="relative h-20">
            <CanvasProgressIndicator progress={{ stage, rendered: false }} />
          </div>
        </div>
      ))}
    </div>
  ),
};

/**
 * `rendered` 记满格：不管游标停在哪一段都是 100%，标签换成「已合成」。
 * 它与上面那一族**不是同一条分支**，必须单独摆出来，否则这两点都验不到。
 */
export const Rendered: Story = {
  args: { progress: { stage: "video", rendered: true } },
};

/**
 * 脏数据的读侧：`normalizeProductionProgress()` 对非法 / 缺字段**回落默认**
 *（不抛）—— 所以下面这几个 `unknown` 进来之后画布上是首帧那一格，而不是报错。
 */
export const TolerantOfDirtyInput: Story = {
  render: () => (
    <div className="grid grid-cols-2 gap-4">
      {[null, {}, { stage: "not-a-stage" }, { rendered: "yes" }].map((raw, i) => (
        <div className="flex flex-col gap-1" key={i}>
          <span className="text-ink-muted font-mono text-[11px]">
            原始值 {JSON.stringify(raw)} → {JSON.stringify(normalizeProductionProgress(raw))}
          </span>
          <div className="relative h-20">
            <CanvasProgressIndicator progress={normalizeProductionProgress(raw)} />
          </div>
        </div>
      ))}
    </div>
  ),
};
