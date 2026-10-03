import type { Meta, StoryObj } from "@storybook/nextjs";

import { WorkshopStageRail } from "~/components/workshop/WorkshopStageRail";
import {
  STAGE_DEFS,
  computeProgressPct,
  computeStageRatios,
  type StageViewContext,
  type Tab,
} from "~/components/workshop/stage-config";

/**
 * 工坊左侧的阶段轨道（六段流程入口）。
 *
 * **它没有数据依赖** —— 入参是 `tab` / `stageRatios` / `viewContext` 三个纯值。
 * 那条看起来像依赖的东西在这里有了正确的解法：`stageRatios` **不手抄**，
 * 而是调 `computeStageRatios(ctx, rendered)`（`stage-config.ts` 的纯函数）
 * 从一份 `StageViewContext` 派生 —— 那正是真机上它唯一的来源。
 *
 * 手抄一份 `{ script: 1, character: 0.5, … }` 就是这一批要消掉的那类假形态：
 * 数字看着对，而它与真实派生逻辑（以及 `stageSubtitle` 的文案规则）无关，
 * 真机上「还差几镜」的说法一旦改了，story 会在旁边继续显示旧口径。
 */
const EMPTY_CTX: StageViewContext = {
  scriptReady: false,
  characterCount: 0,
  sceneCount: 0,
  shotTarget: 0,
  shotCount: 0,
  imageDoneCount: 0,
  clipDoneCount: 0,
};

/** 真机上的中途态：剧本就绪、建了 2 个角色、8 镜排了 5 张图、2 个片段。 */
const MIDWAY_CTX: StageViewContext = {
  scriptReady: true,
  characterCount: 2,
  sceneCount: 3,
  shotTarget: 8,
  shotCount: 8,
  imageDoneCount: 5,
  clipDoneCount: 2,
};

/** 全部走完（成片已合成）：六段都满，副标题一路「已完成」。 */
const DONE_CTX: StageViewContext = {
  ...MIDWAY_CTX,
  imageDoneCount: 8,
  clipDoneCount: 8,
};

/** 只有剧本、还没拆场景：`shotTarget` 为 0 是「没有可派生的目标」那一档。 */
const SCRIPT_ONLY_CTX: StageViewContext = {
  ...EMPTY_CTX,
  scriptReady: true,
};

/** 这一族 story 的 Args：一个**阶段上下文** + 当前段 + 是否已渲染。 */
type StoryArgs = {
  ctx: StageViewContext;
  tab: Tab;
  /** 成片是否已经渲染出来（`computeStageRatios` 的 `render` 档取决于它）。 */
  rendered: boolean;
};

function RailSample({ ctx, tab, rendered }: StoryArgs) {
  const ratios = computeStageRatios(ctx, rendered);
  return (
    <div className="flex flex-col gap-4">
      <div className="w-64">
        <WorkshopStageRail
          tab={tab}
          stageRatios={ratios}
          viewContext={ctx}
          onTabChange={() => undefined}
        />
      </div>
      <p className="text-ink-muted font-mono text-[11px]">
        总进度 {computeProgressPct(ratios)}% · rendered={String(rendered)}
      </p>
    </div>
  );
}

const meta = {
  title: "Workshop/WorkshopStageRail",
  component: RailSample,
  args: {
    ctx: MIDWAY_CTX,
    tab: "shots",
    rendered: false,
  },
  argTypes: {
    tab: {
      control: { type: "select" },
      options: STAGE_DEFS.map((stage) => stage.id),
    },
  },
} satisfies Meta<StoryArgs>;

export default meta;

type Story = StoryObj<typeof meta>;

/** 中途态：脚本 / 角色 / 分镜已完成，逐镜与视频进行中。 */
export const Midway: Story = {};

/** 空白项目：六段都还没开始，副标题走 `stageSubtitle` 的空态文案。 */
export const EmptyProject: Story = {
  args: { ctx: EMPTY_CTX, tab: "script" },
};

/** 只写了剧本：分镜还没拆，`shotTarget` 为 0 —— 「还差几镜」没有答案那一档。 */
export const ScriptOnly: Story = {
  args: { ctx: SCRIPT_ONLY_CTX, tab: "storyboard" },
};

/** 全部走完 + 成片已渲染：一路「已完成」。 */
export const Complete: Story = {
  args: { ctx: DONE_CTX, tab: "render", rendered: true },
};

/** 每一段各自被选中时的副标题（「进行中」只在当前段出现）。 */
export const EachStageCurrent: Story = {
  args: { ctx: MIDWAY_CTX },
  render: (args) => (
    <div className="flex flex-wrap gap-6">
      {STAGE_DEFS.map((stage) => (
        <div key={stage.id} className="flex flex-col items-start gap-1.5">
          <span className="text-ink-muted font-mono text-[11px]">
            {stage.id}
          </span>
          <RailSample {...args} tab={stage.id} />
        </div>
      ))}
    </div>
  ),
};
