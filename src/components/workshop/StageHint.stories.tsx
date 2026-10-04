import type { Meta, StoryObj } from "@storybook/nextjs";

import { StageHint } from "~/components/workshop/StageHint";

/**
 * 阶段前置温和提示条 —— 纯展示，文案与跳转目标由调用处给，**不阻断任何操作**。
 *
 * 入参只有 `text` 与 `onGo` 两个，是这一批里数据依赖最薄的一件。它值得有 story
 * 的地方不在「长得对」，而在**它与 `DraftIntegrityHint` 的分工**：两条都是琥珀色
 * 提示条，差别是「阶段还没做完」（按钮写死「去完成」）与「数据里有读不懂的东西」。
 * 两条并排放着看，下次想省一个文件把按钮改回「去完成」时能先看见代价。
 */
const meta = {
  title: "Workshop/StageHint",
  component: StageHint,
  args: {
    text: "还没有角色卡 —— 先生成角色卡，镜头生图才能带入人物一致性。",
    onGo: () => undefined,
  },
} satisfies Meta<typeof StageHint>;

export default meta;

type Story = StoryObj<typeof meta>;

/** 真机文案：当前阶段缺它的前置产物。 */
export const Default: Story = {};

/**
 * 长文案：提示条**不截断**（这条幅的用途是让人读懂为什么该先去那一步），
 * 换行由 `flex-1` 那一格承担。窄容器里才是这条判据的现场。
 */
export const LongTextInNarrowContainer: Story = {
  args: {
    text: "还没有选择视频工作流 —— 去工作室的「工作流库」导入一个 img2video 工作流并标记为视频类，这一屏才会出现驱动首帧的入口。",
  },
  render: (args) => (
    <div className="w-80">
      <StageHint {...args} />
    </div>
  ),
};
