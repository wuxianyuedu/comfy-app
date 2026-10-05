import type { Meta, StoryObj } from "@storybook/nextjs";

import {
  FrostLayer,
  NodeFrost,
  PseudoFrostLayer,
} from "~/components/studio/canvas/NodeFrost";
import {
  StorybookFlowCanvas,
  canvasScene,
  withNodeType,
} from "../../../../.storybook/flow-canvas";
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
 * 绕过 / 禁用节点用的毛玻璃层 —— 第二层注入（React Flow）里**缩放**那一维的现场。
 *
 * 这一族有一半是纯 props、另一半吃画布上下文，分开说：
 *
 *  · `NodeFrost({ zoom, color, nodeMode })` —— **纯 props**，`zoom` 是入参；
 *  · `FrostLayer` —— 自己订阅 `useStore(s => s.transform[2])`，所以只能在真画布里
 *    看（下面 `InCanvas` 那一档）。它存在的理由正是**性能**：把缩放订阅从每个节点
 *    挪到这一层，普通节点就不必在捏合 / 滚轮缩放时重渲染。
 *
 * 要看的是 Chromium 那条经典 bug 的**修法**在画布上真的成立：`backdrop-filter`
 * 在屏幕占位极小的元素上会重铺平铺，缩小时出现 2² / 3² / 4² 重影。修法是按
 * `1/zoom` 反向缩放模糊元素、外层 `overflow:hidden` 裁回节点边界 —— 所以这里
 * 把三档缩放并排，重影在 `zoom < 1` 那两档最容易看出来。
 *
 * `nodeMode` 的取值来自 LiteGraph：`0` 始终 / `2` 静音（灰）/ `4` 旁路（粉），
 * 颜色由 `computeNodePalette()` 给出 —— 不手抄色值。
 */
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
function FrostCard({
  zoom,
  nodeMode,
  label,
}: {
  zoom: number;
  nodeMode: number;
  label: string;
}) {
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
        <NodeFrost
          zoom={zoom}
          color={palette.modeColor}
          nodeMode={palette.nodeMode}
        />
        <div
          className={`relative ${zClass("base")} p-3 text-[12px]`}
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
        <FrostCard key={zoom} zoom={zoom} nodeMode={4} label="旁路（粉）" />
      ))}
    </div>
  ),
};

/** 两档模式色并排：旁路 `#7C5CFC` 偏粉、静音偏灰 —— 用户靠颜色读 ComfyUI 状态。 */
export const ModeColors: Story = {
  render: () => (
    <div className="flex flex-wrap items-start gap-6 p-4">
      <FrostCard zoom={1} nodeMode={4} label="旁路 nodeMode=4" />
      <FrostCard zoom={1} nodeMode={2} label="静音 nodeMode=2" />
      <FrostCard
        zoom={1}
        nodeMode={0}
        label="始终 nodeMode=0（不渲染毛玻璃）"
      />
    </div>
  ),
};

/**
 * 真画布里的 `FrostLayer`：缩放来自 `useStore`，不是 props ——
 * 这份 story 的存在就是为了让「缩放订阅挪到独立一层」这个设计在真上下文里成立。
 */
export const InCanvas: Story = {
  render: () => (
    <div className="p-4">
      <StorybookFlowCanvas
        scene={withNodeType(canvasScene("zoomedIn"), "story")}
        nodeTypes={FROST_NODE_TYPES}
      />
    </div>
  ),
};

/** 真画布里的节点渲染器：走 `FrostLayer`，所以缩放由 store 给。 */
function FrostDemoNode() {
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
        className={`relative ${zClass("base")} p-3 text-[12px]`}
        style={{ color: DARK_PALETTE_BASE.titleFallback }}
      >
        KSampler（旁路 · 缩放来自 store）
      </div>
    </div>
  );
}

const FROST_NODE_TYPES = { story: FrostDemoNode };
