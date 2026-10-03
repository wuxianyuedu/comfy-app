import type { Meta, StoryObj } from "@storybook/nextjs";

import {
  CHIP_NEUTRAL_COLOR,
  Chip,
  FrontendOnlyBadge,
  RequiredSummary,
} from "~/components/studio/RequiredSummary";
import type { WorkflowIOMap } from "~/lib/workflow/workflow-io-types";

/**
 * `studio/` 的第一个 story：这是**整批里数据形态最清楚的一个** ——
 * `RequiredSummary` 吃一份 `WorkflowIOMap`（工作流 IO 的真实投影，定义在
 * `~/lib/workflow/workflow-io-types`），算「必填几个 / 可选几个」。
 *
 * 它此前被归进「有数据依赖」那一批，但那份依赖是**纯数据**：`io` 就是一个
 * `Record<string, WorkflowIOEntry>`，既没有 tRPC 也不是运行期状态。所以它不需要
 * 注入层 —— 只要按**真类型**给一份形状对得上的 map 就够了（而不是随便捏个
 * `{ a: 1 }` 让组件渲染出 `必填 0 / 可选 0`）。
 *
 * 这一组 story 因此也是**「数据依赖」这个词的校准点**：
 * 「吃一个结构化入参」不是数据依赖，「吃一条 tRPC 链路 / 浏览器运行期」才是。
 * 后者见 `LocalComputeCard` / `HomeModelOverview` 那几条。
 */
const ENTRY = {
  direction: "input",
  kind: "widget",
  nodeId: "5",
  name: "width",
} as const;

/** 步数那条：多模式那份要基于它改，所以单独命名（`REAL_IO` 里引这一份）。 */
const STEPS_ENTRY: WorkflowIOMap[string] = {
  ...ENTRY,
  nodeId: "3",
  name: "steps",
  label: "步数",
  type: "INT",
  required: false,
  defaultValue: 24,
};

/** 一份真 IO map：三个必填 widget + 两个可选 + 一个输出（输出不计入统计）。 */
const REAL_IO: WorkflowIOMap = {
  "5:width": {
    ...ENTRY,
    label: "宽度",
    type: "INT",
    required: true,
    defaultValue: 1024,
  },
  "5:height": {
    ...ENTRY,
    name: "height",
    label: "高度",
    type: "INT",
    required: true,
    defaultValue: 1024,
  },
  "6:text": {
    ...ENTRY,
    nodeId: "6",
    name: "text",
    label: "提示词",
    type: "STRING",
    multiline: true,
    required: true,
  },
  "3:seed": {
    ...ENTRY,
    nodeId: "3",
    name: "seed",
    label: "随机种子",
    type: "INT",
    required: false,
    defaultValue: 0,
    seedMode: "random",
  },
  "3:steps": STEPS_ENTRY,
  "9:images": {
    direction: "output",
    kind: "output",
    nodeId: "9",
    name: "images",
    label: "输出图像",
    type: "IMAGE",
  },
};

/**
 * 多模式：同一个条目在不同模式下的必填性不同（`modeOverrides` 的真形状）。
 *
 * 基于 `STEPS_ENTRY` 这份**命名常量**扩展而不是 `REAL_IO["3:steps"]!` ——
 * 后者要一个非空断言（`WorkflowIOMap` 是 `Record`，索引访问的类型带 `undefined`），
 * 而那个 `!` 会撞 `scripts/check-non-null-assertions.cjs`（判据是对的：这里没有
 * 任何「我知道它一定在」的理由，换成命名常量就不需要断言了）。
 */
const MODE_IO: WorkflowIOMap = {
  ...REAL_IO,
  "3:steps": {
    ...STEPS_ENTRY,
    modeOverrides: { turbo: { required: true }, draft: { visible: false } },
  },
};

const meta = {
  title: "Studio/RequiredSummary",
  component: RequiredSummary,
  args: { io: REAL_IO, mode: null },
  argTypes: {
    mode: {
      control: { type: "select" },
      options: [null, "turbo", "draft"],
      description: "多模式：按该模式解析 required",
    },
  },
} satisfies Meta<typeof RequiredSummary>;

export default meta;

type Story = StoryObj<typeof meta>;

/** 真实工作流：3 个必填 widget + 2 个可选（输出方向不计入统计）。 */
export const RealWorkflow: Story = {};

/** 空 IO（工作流还没解析出来）：两个数字都是 0，而不是崩掉。 */
export const Empty: Story = {
  args: { io: {} },
};

/** `io` 为 `null`（还没拿到工作流详情的首帧）—— 与空 map 走同一条路。 */
export const NotLoaded: Story = {
  args: { io: null },
};

/** 多模式：切到 `turbo` 之后步数也变必填，数字跟着动。 */
export const ModeOverrides: Story = {
  args: { io: MODE_IO, mode: "turbo" },
};

/**
 * 同族的两个小徽标：`Chip`（画布 corner 上的统计胶囊）与 `FrontendOnlyBadge`
 *（「此节点只在浏览器前端运行」的标记）。
 *
 * `CHIP_NEUTRAL_COLOR` 是「中性统计」的唯一口径 —— 写死 `#a1a1aa` 在浅色底
 * 上只有 ~2:1 的对比度（读不出来），这个常量走的是随主题的弱文字 token。
 */
export const Chips: Story = {
  render: () => (
    <div className="flex flex-col items-start gap-3">
      <div className="flex items-center gap-2">
        <Chip color={CHIP_NEUTRAL_COLOR} label="中性统计" />
        <Chip color="var(--color-destructive)" label="必填" />
        <Chip color="var(--color-primary)" label="主色" />
      </div>
      <FrontendOnlyBadge />
      <div className="text-ink-muted text-xs">
        徽标在画布节点上是**叠在浅底上的**，所以它们的配色只从 token 取
      </div>
    </div>
  ),
};
