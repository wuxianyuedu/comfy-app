import type { Meta, StoryObj } from "@storybook/nextjs";

import {
  CanvasProgressIndicator,
  stageProgressPct,
} from "~/components/studio/project-canvas/CanvasProgressIndicator";
import {
  PRODUCTION_STAGES,
  normalizeProductionProgress,
} from "~/lib/production/progress";

/**
 * 画布侧「生产进度」指示器 —— **纯展示**，入参只有一份 `ProductionProgress`
 *（`{ stage, rendered }`，持久来源是 `production` 行的 `progress` 列，工坊与画布
 * 共读同一份）。
 *
 * 它没有数据依赖，但有一件**必须由判据派生、不能手抄**的东西：百分比。所以 story
 * 里的档位逐条调 `stageProgressPct()`（组件自己用的那个出口），不写死 `33%` ——
 * 手抄一份数字就是这一批要消掉的假形态（阶段序改了 story 会继续显示旧口径）。
 *
 * 要看的是两件在真机上容易混的事：
 *   · **阶段游标**：六段每段各自的读数（`rendered` 记满格，否则按阶段序）；
 *   · **`rendered` 是另一档**：它不参与阶段序，直接 100% 且文案换成「已合成」。
 *
 * 真机位置是画布左上角的绝对定位（`z-canvas-ui`），所以 story 里给一个相对定位的
 * 容器 —— 否则那件 `absolute` 会跑到画布外面去，看不到它真实的样子。
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
        <div key={stage} className="flex flex-col gap-1">
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
 * `rendered` 记满格：不管游标停在哪一段都是 100%，且标签换成「已合成」。
 *
 * 这一档与上面那一族**不是同一条分支**，所以要单独摆出来 —— 只测阶段游标的话，
 * 「已合成」那句文案与 100% 都验不到。
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
      {[null, {}, { stage: "not-a-stage" }, { rendered: "yes" }].map(
        (raw, i) => (
          <div key={i} className="flex flex-col gap-1">
            <span className="text-ink-muted font-mono text-[11px]">
              原始值 {JSON.stringify(raw)} →{" "}
              {JSON.stringify(normalizeProductionProgress(raw))}
            </span>
            <div className="relative h-20">
              <CanvasProgressIndicator
                progress={normalizeProductionProgress(raw)}
              />
            </div>
          </div>
        ),
      )}
    </div>
  ),
};
