import type { Meta, StoryObj } from "@storybook/nextjs";

import { WorkshopStageItem } from "~/components/workshop/WorkshopStageItem";
import { STAGE_DEFS } from "~/components/workshop/stage-config";

/**
 * 阶段条目（`WorkshopStageItem`）—— 横向阶段条与竖向阶段轨道**共用**的那一件。
 *
 * 它是**纯 props** 的：`label` / `subtitle` / `ordinal` / `ratio` / `isCurrent`
 * 全由调用处给，没有 tRPC、没有运行期状态。所以这里没有注入层的事，关键是
 * **让三态同时出现** —— 完成度徽章那一格有三条判据（`ratio >= 1` 换成勾、
 * 当前段走品牌色、未开始显示序号），而它们只有在同一屏里并排时才看得出区别。
 *
 * `className` 刻意不进 Args：按规范 03 §3.8.1.1，基元不预设 `w-full` / `flex-1`
 * 这类占位方式，占位由调用处的布局给（横排传 `flex-1`，竖排传 `w-full`）。
 * 所以 story 里由两档摆放位置各给一次 —— 那正是这条约定要看到的形态。
 */
const meta = {
  title: "Workshop/WorkshopStageItem",
  component: WorkshopStageItem,
  args: {
    label: "场景分镜",
    subtitle: "8 镜已排 · 3 个场景",
    ordinal: 3,
    ratio: 0.5,
    isCurrent: false,
    onSelect: () => undefined,
  },
  argTypes: {
    ratio: { control: { type: "range", min: 0, max: 1, step: 0.05 } },
    isCurrent: { control: { type: "boolean" } },
  },
} satisfies Meta<typeof WorkshopStageItem>;

export default meta;

type Story = StoryObj<typeof meta>;

/** 单条的中途态：徽章显示序号，副标题走「进行中」的文案。 */
export const Default: Story = {};

/** 选中态：品牌色徽章 + 选中环 + 主色标题（`aria-current="step"`）。 */
export const Current: Story = {
  args: { isCurrent: true },
};

/**
 * 完成态：`ratio` 到 1 就**换成勾**，副标题也换成功那一路的配色。
 *
 * 这条判据值得单独看：徽章在完成段里显示的是勾还是数字，此前横排与竖排可以长得
 * 不一样（两处各写一遍时漂的就是它）。同一个组件的两档 `ratio` 并排，一眼能对。
 */
export const DoneVersusRunning: Story = {
  render: (args) => (
    <div className="flex flex-col gap-2">
      <WorkshopStageItem {...args} label="剧本" ordinal={1} ratio={1} />
      <WorkshopStageItem
        {...args}
        label="角色卡"
        ordinal={2}
        ratio={0.4}
        isCurrent
      />
      <WorkshopStageItem {...args} label="场景分镜" ordinal={3} ratio={0} />
    </div>
  ),
};

/**
 * 两档摆放位置：横排（`flex-1`，六段均分）与竖排（`w-full`，轨道占满）。
 *
 * 占位方式由调用处给，所以这里看到的正是「同一件组件在两种布局里各长什么样」——
 * 而 `flex-1` 与 `w-full` 只有放在真容器里才看得出区别。
 */
export const BothLayouts: Story = {
  render: (args) => (
    <div className="flex flex-col gap-6">
      <div>
        <p className="text-ink-muted mb-2 text-[11px]">
          横向（阶段条，flex-1）
        </p>
        <div className="flex items-stretch gap-2">
          {STAGE_DEFS.map((stage, i) => (
            <WorkshopStageItem
              key={stage.id}
              {...args}
              label={stage.label}
              ordinal={i + 1}
              ratio={i < 2 ? 1 : i === 2 ? 0.5 : 0}
              isCurrent={i === 2}
              className="flex-1"
            />
          ))}
        </div>
      </div>
      <div>
        <p className="text-ink-muted mb-2 text-[11px]">
          竖向（阶段轨道，w-full）
        </p>
        <div className="flex w-64 flex-col gap-2">
          {STAGE_DEFS.map((stage, i) => (
            <WorkshopStageItem
              key={stage.id}
              {...args}
              label={stage.label}
              ordinal={i + 1}
              ratio={i < 2 ? 1 : i === 2 ? 0.5 : 0}
              isCurrent={i === 2}
              className="w-full"
            />
          ))}
        </div>
      </div>
    </div>
  ),
};
