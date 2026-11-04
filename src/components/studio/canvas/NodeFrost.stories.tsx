import type { Meta, StoryObj } from "@storybook/nextjs";

import { FrostLayer, NodeFrost, PseudoFrostLayer } from "~/components/studio/canvas/NodeFrost";
import { StorybookFlowCanvas, canvasScene, withNodeType } from "../../../../.storybook/flow-canvas";
import {
  computeNodePalette,
  DARK_PALETTE_BASE,
} from "~/components/studio/canvas/workflow-node-palette";
/* 节点**角色色**（`computeNodePalette()` 的第二个入参）经端点的类型色出口取 ——
 * 与画布节点里那份同一来源，不在 story 里另写一遍 palette 字面量。 */
import { portChipStyle } from "~/components/studio/workflow-form/WorkflowPortHandle";
import { zClass } from "~/lib/shell/overlay-z";

/** 一个真角色的颜色（`IMAGE` 档）；`NodeFrost` 的 `color` 入参就是这种值。 */
const ROLE_COLOR = portChipStyle("IMAGE").color;

/**
 * 毛玻璃层 story — 缩放维度。`NodeFrost` 纯 props（zoom/color/nodeMode）；FrostLayer 自订阅 `transform[2]`，
 * 只能在真画布看（缩放订阅收口到该层，避免全体节点重渲染）。验 Chromium backdrop-filter 小元素重铺 bug：
 * 按 1/zoom 反向缩放 + overflow:hidden 裁回，并排三档，zoom<1 最易见 2²/3²/4² 重影。
 * nodeMode = LiteGraph 0 始终 / 2 静音 / 4 旁路，颜色由 `computeNodePalette()` 给出。 */
const meta = {
  title: "Studio/Canvas/NodeFrost",
  component: NodeFrost,
  args: { zoom: 1, color: ROLE_COLOR, nodeMode: 4 },
  argTypes: {
    zoom: { control: { type: "range", min: 0.1, max: 2, step: 0.05 } },
    color: { control: { type: "color" } },
    nodeMode: { control: { type: "inline-radio" }, options: [0, 2, 4] },
  },
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof NodeFrost>;

export default meta;

type Story = StoryObj<typeof meta>;

/** 节点卡片的摆法（`relative` + `overflow-hidden` 是毛玻璃能被裁回边界的前提）。 */
function FrostCard({ zoom, nodeMode, label }: { label: string; nodeMode: number; zoom: number }) {
  /* SAFETY: 类型断言已复核 */
  const palette = computeNodePalette(
    { mode: nodeMode } as Parameters<typeof computeNodePalette>[0],
    { color: ROLE_COLOR },
    DARK_PALETTE_BASE,
  );
  return (
    <div className="flex flex-col items-center gap-2">
      <div
        className="relative h-35 w-60 overflow-hidden rounded-[14px]"
        style={{
          background: DARK_PALETTE_BASE.body,
          border: `1px solid ${DARK_PALETTE_BASE.borderFallback}`,
        }}
      >
        <PseudoFrostLayer modeColor={palette.modeColor} />
        <NodeFrost color={palette.modeColor} nodeMode={palette.nodeMode} zoom={zoom} />
        <div
          className={`relative ${zClass("base")} p-3 text-xs`}
          style={{ color: DARK_PALETTE_BASE.titleFallback }}
        >
          {label}
        </div>
      </div>
      <span className="text-ink-muted text-2xs font-mono">
        zoom {zoom} · mode {nodeMode}
      </span>
    </div>
  );
}

/**
 * 缩放三档并排（纯 props）：Chromium 的重铺平铺 bug 在**缩小**那两档最容易看出来 ——
 * 修法（`scale = 1/zoom`）如果被去掉，圆角处会出现 2² / 3² / 4² 的重影。
 */
export const ZoomLadder: Story = {
  render: () => (
    <div className="flex flex-wrap items-start gap-6 p-4">
      {[0.25, 0.5, 1, 2].map((zoom) => (
        <FrostCard key={zoom} label="旁路（粉）" nodeMode={4} zoom={zoom} />
      ))}
    </div>
  ),
};

/** 两档模式色并排：旁路 `#7C5CFC` 偏粉、静音偏灰 —— 用户靠颜色读 ComfyUI 状态。 */
export const ModeColors: Story = {
  render: () => (
    <div className="flex flex-wrap items-start gap-6 p-4">
      <FrostCard label="旁路 nodeMode=4" nodeMode={4} zoom={1} />
      <FrostCard label="静音 nodeMode=2" nodeMode={2} zoom={1} />
      <FrostCard label="始终 nodeMode=0（不渲染毛玻璃）" nodeMode={0} zoom={1} />
    </div>
  ),
};

const FROST_NODE_TYPES = { story: FrostDemoNode };

/**
 * 真画布里的 `FrostLayer`：缩放来自 `useStore`，不是 props ——
 * 这份 story 的存在就是为了让「缩放订阅挪到独立一层」这个设计在真上下文里成立。
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

/** 真画布里的节点渲染器：走 `FrostLayer`，所以缩放由 store 给。 */
function FrostDemoNode() {
  /* SAFETY: 类型断言已复核 */
  const palette = computeNodePalette(
    { mode: 4 } as Parameters<typeof computeNodePalette>[0],
    { color: ROLE_COLOR },
    DARK_PALETTE_BASE,
  );
  return (
    <div
      className="relative h-27.5 w-55 overflow-hidden rounded-[14px]"
      style={{ border: `1px solid ${DARK_PALETTE_BASE.borderFallback}` }}
    >
      <FrostLayer color={palette.modeColor} nodeMode={palette.nodeMode} />
      <div
        className={`relative ${zClass("base")} p-3 text-xs`}
        style={{ color: DARK_PALETTE_BASE.titleFallback }}
      >
        KSampler（旁路 · 缩放来自 store）
      </div>
    </div>
  );
}
