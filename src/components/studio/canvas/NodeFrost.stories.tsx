import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { FrostLayer, NodeFrost, PseudoFrostLayer } from "~/components/studio/canvas/NodeFrost";
import { StorybookFlowCanvas, canvasScene, withNodeType } from "../../../../.storybook/flow-canvas";
import {
  computeNodePalette,
  DARK_PALETTE_BASE,
} from "~/components/studio/canvas/workflow-node-palette";
/* 节点**角色色**（`computeNodePalette()` 的第二个入参）经端点的类型色出口取 ——
 * 与画布节点里那份同一来源，不在 story 里另写一遍 palette 字面量。 */
import { portChipStyle } from "~/components/studio/workflow-form/WorkflowPortHandle";
import type { WorkflowNodeData } from "~/components/studio/workflow-types";
import { zClass } from "~/lib/shell/overlay-z";

/** 一个真角色的颜色（`IMAGE` 档）；`NodeFrost` 的 `color` 入参就是这种值。 */
const ROLE_COLOR = portChipStyle("IMAGE").color;

/**
 * 模式着色层 story。ISSUE #4578 补充起，旁路 / 停用节点 = **不透明角色底色**
 * （卡片本体铺 `nodeBgOpaque`，与 WorkflowNode 同一口径）+ `<NodeFrost>` 叠模式色
 * —— 不再透采画布：悬停抬层（ISSUE #400）改变层叠序时节点颜色恒定。
 * nodeMode = LiteGraph 0 始终 / 2 静音 / 4 旁路，颜色由 `computeNodePalette()` 给出。
 */
const meta = {
  title: "Studio/Canvas/NodeFrost",
  component: NodeFrost,
  args: { color: ROLE_COLOR, nodeMode: 4 },
  argTypes: {
    color: { control: { type: "color" } },
    nodeMode: { control: { type: "inline-radio" }, options: [0, 2, 4] },
  },
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof NodeFrost>;

export default meta;

type Story = StoryObj<typeof meta>;

/** `computeNodePalette()` 只读 `mode`，入参却声明为完整节点数据 —— 补齐必填项，不写断言。 */
function nodePaletteFor(nodeMode: number) {
  const data: WorkflowNodeData = {
    assignedRole: null,
    classType: "KSampler",
    inputs: {},
    inputSources: {},
    mode: nodeMode,
    nodeId: "story",
    title: "KSampler",
  };
  return computeNodePalette(data, { color: ROLE_COLOR }, DARK_PALETTE_BASE);
}

/** 节点卡片的摆法：底色 = `nodeBgOpaque`（不透明），着色层叠在其上。 */
function FrostCard({ nodeMode, label }: { label: string; nodeMode: number }) {
  const palette = nodePaletteFor(nodeMode);
  return (
    <div className="flex flex-col items-center gap-2">
      <div
        className="relative h-35 w-60 overflow-hidden rounded-[14px]"
        style={{
          background: palette.nodeBgOpaque,
          border: `1px solid ${DARK_PALETTE_BASE.borderFallback}`,
        }}
      >
        <PseudoFrostLayer modeColor={palette.modeColor} />
        <NodeFrost color={palette.modeColor} nodeMode={palette.nodeMode} />
        <div
          className={`relative ${zClass("base")} p-3 text-xs`}
          style={{ color: DARK_PALETTE_BASE.titleFallback }}
        >
          {label}
        </div>
      </div>
      <span className="text-ink-muted text-2xs font-mono">mode {nodeMode}</span>
    </div>
  );
}

/** 两档模式色并排：旁路 `#ec4899` 偏粉、静音偏灰 —— 用户靠颜色读 ComfyUI 状态；
 *  底色不透明，颜色不随悬停 / 层叠漂移（ISSUE #4578 补充）。 */
export const ModeColors: Story = {
  render: () => (
    <div className="flex flex-wrap items-start gap-6 p-4">
      <FrostCard label="旁路 nodeMode=4" nodeMode={4} />
      <FrostCard label="静音 nodeMode=2" nodeMode={2} />
      <FrostCard label="始终 nodeMode=0（不渲染着色层）" nodeMode={0} />
    </div>
  ),
};

const FROST_NODE_TYPES = { story: FrostDemoNode };

/**
 * 真画布里的 `FrostLayer`：接线层不再订阅缩放（旧版为 backdrop-filter 的
 * 缩放补偿而订阅；着色层不透采画布后没有可补偿的量）。
 */
export const InCanvas: Story = {
  render: () => (
    <div className="p-4">
      <StorybookFlowCanvas
        nodeTypes={FROST_NODE_TYPES}
        scene={withNodeType(canvasScene("zoomedIn"), "story")}
      />
    </div>
  ),
};

/** 真画布里的节点渲染器：走 `FrostLayer`；底色与 WorkflowNode 同一口径。 */
function FrostDemoNode() {
  const palette = nodePaletteFor(4);
  return (
    <div
      className="relative h-27.5 w-55 overflow-hidden rounded-[14px]"
      style={{
        background: palette.nodeBgOpaque,
        border: `1px solid ${DARK_PALETTE_BASE.borderFallback}`,
      }}
    >
      <FrostLayer color={palette.modeColor} nodeMode={palette.nodeMode} />
      <div
        className={`relative ${zClass("base")} p-3 text-xs`}
        style={{ color: DARK_PALETTE_BASE.titleFallback }}
      >
        KSampler（旁路）
      </div>
    </div>
  );
}
