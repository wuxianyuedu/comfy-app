import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import {
  WorkflowPickChip,
  type WorkflowPickOption,
} from "~/components/studio/project-canvas/WorkflowPickChip";

/**
 * 画布工作流节点上的「工作流选择」chip（纯 props）。
 * 已选中显示工作流名 / 未选中「选择工作流…」/ 加载中同形态但走 `PageLoading`
 * （不许把加载态渲染成空态）。选项行圆点按 `sourcePath` 分叉（本机 `status-online`）。
 */
const OPTIONS: Array<WorkflowPickOption> = [
  {
    id: "wf_local",
    name: "角色一致性 · 三视图",
    taskType: "image",
    sourcePath: "/workflows/character-3view.json",
    modelTags: ["SDXL"],
  },
  {
    id: "wf_online",
    name: "首帧 → 逐镜生成",
    taskType: "video",
    sourcePath: null,
    modelTags: ["Wan2.2"],
  },
  { id: "wf_plain", name: "无类型标记的旧工作流", sourcePath: null },
];

const meta = {
  title: "Studio/WorkflowPickChip",
  component: WorkflowPickChip,
  args: { value: "wf_local", options: OPTIONS, onSelect: () => undefined },
  argTypes: {
    value: { control: { type: "text" } },
    options: { control: { type: "object" } },
    loading: { control: { type: "boolean" } },
  },
} satisfies Meta<typeof WorkflowPickChip>;

export default meta;

type Story = StoryObj<typeof meta>;

/** 已选中：触发器显示工作流名（长名字走 `truncate`，不撑破节点宽度）。 */
export const Selected: Story = {};

/** 未选中：占位文案。 */
export const NotSelected: Story = {
  args: { value: "" },
};

/**
 * 加载中：**不许把加载态渲染成空态** —— 触发器说「加载中…」，
 * 下拉里也走 `PageLoading`。与上一档并排，两者只差一个词，但用户的下一步动作相反
 *（一个是「等等」，一个是「去别处建一个」）。
 */
export const LoadingVersusEmpty: Story = {
  render: () => (
    <div className="flex min-h-64 items-start gap-6">
      <div className="flex flex-col items-start gap-1.5">
        <span className="text-ink-muted font-mono text-[11px]">loading = true</span>
        <WorkflowPickChip loading onSelect={() => undefined} options={[]} value="" />
      </div>
      <div className="flex flex-col items-start gap-1.5">
        <span className="text-ink-muted font-mono text-[11px]">loading = false · options = []</span>
        <WorkflowPickChip onSelect={() => undefined} options={[]} value="" />
      </div>
    </div>
  ),
};

/** 自定义空提示：同一档空态，出口文案由调用处给（节点上说的是「去工作流库导入」）。 */
export const CustomEmptyHint: Story = {
  args: {
    value: "",
    options: [],
    emptyHint: "本机还没有工作流，去工作室的「工作流库」导入",
  },
  render: (args) => (
    <div className="flex min-h-40 items-start">
      <WorkflowPickChip {...args} />
    </div>
  ),
};

/** 未展开的下拉在画布上就是这样一个小按钮 —— 选项前缀圆点与类型标记的差异要展开才看得见。 */
export const NarrowContainer: Story = {
  render: (args) => (
    <div className="bg-canvas-deep border-border-strong w-56 rounded-xl border p-2">
      <WorkflowPickChip {...args} />
    </div>
  ),
};
