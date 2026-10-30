import type { Meta, StoryObj } from "@storybook/nextjs";
import { useMemo } from "react";

import { PortHandle, portChipStyle } from "~/components/studio/workflow-form/WorkflowPortHandle";
import { DARK_PALETTE_BASE } from "~/components/studio/canvas/workflow-node-palette";
import { StorybookFlowCanvas, canvasScene, withNodeType } from "../../../../.storybook/flow-canvas";

/**
 * 画布端点（`PortHandle`）—— 第二层注入（React Flow）的**核心现场**。
 *
 * ## 为什么它此前写不出 story
 *
 * 它内部调 `useNodeId()`：拿不到宿主节点 id 时，React Flow 的 `<Handle>` 直接抛
 * error#010（"No node id found"）。所以「挂个假 provider」不是出路 —— 真
 * `<ReactFlow>` 里长出来的端点几何（骑跨卡片边框、圆心锁在子行中线）才是这份
 * story 要看的东西。注入层（`.storybook/flow-canvas.tsx`）给的就是那块真画布，
 * 节点渲染器由 story 通过 `nodeTypes` 注入。
 *
 * ## 要看的三条
 *
 *  · **类型 → 颜色**：IMAGE/MASK 紫、VIDEO/AUDIO 粉、STRING/INT 中性灰、
 *    BOOLEAN 绿、未知类型青（`portColorFor()` 的五个分支，逐档并排）；
 *  · **进出描边不同**：输入 `#4D4D59`、输出是卡片底色（外半圆在内、内半圆在外）；
 *  · **没有 node 上下文时退化为装饰圆点**：同一个组件在画布外（如 IO 预览面板、
 *    工作流库预览）复用同一行部件时，几何必须**完全一致** —— 那是同一条判据的
 *    另一半，所以下面两档并排给。
 */
const meta = {
  title: "Studio/WorkflowForm/WorkflowPortHandle",
  component: PortHandle,
  args: { id: "3:images", dir: "out", type: "IMAGE" },
  argTypes: {
    id: { control: { type: "text" } },
    dir: { control: { type: "inline-radio" }, options: ["in", "out"] },
    type: { control: { type: "text" } },
  },
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof PortHandle>;

export default meta;

type Story = StoryObj<typeof meta>;

/**
 * 端口行用的类型（ComfyUI 的真类型名 —— `normalizeTypeChip()` 只认那几个，
 * 自造的词会落到「未知类型」那一档、看不出差别）。
 */
const PORT_ROWS: Array<{ id: string; dir: "in" | "out"; type?: string }> = [
  { id: "3:model", dir: "in", type: "MODEL" },
  { id: "3:positive", dir: "in", type: "CONDITIONING" },
  { id: "3:latent_image", dir: "in", type: "LATENT" },
  { id: "3:images", dir: "out", type: "IMAGE" },
  { id: "12:video", dir: "out", type: "VIDEO" },
  { id: "9:prompt", dir: "out", type: "STRING" },
  { id: "9:steps", dir: "out", type: "INT" },
  { id: "9:enabled", dir: "out", type: "BOOLEAN" },
  { id: "9:custom", dir: "out", type: "IMAGEUPLOAD" },
];

/**
 * 一行端点。**内边距在行上、不在卡片上**（与 `OutputRowPort` / 画布节点同一份
 * 几何）：行是 `relative` 的、内容有 `px-3.5`，于是 `left/right: -6` 的端点正好
 * 骑在卡片边框上。把 `px-3.5` 放到卡片上时端点会压住标签 —— 那是这一层最容易
 * 摆错的一处，所以 story 里按真结构来。
 */
function PortRow({ portId, dir, type }: { portId: string; dir: "in" | "out"; type?: string }) {
  /* 卡面取**节点调色板的底色**（`DARK_PALETTE_BASE.body`）而不是再写一遍 hex ——
     那是画布节点卡片表面的唯一出处（类型色则经 `portChipStyle()` 取，同源）。 */
  return (
    <div className="relative w-80" style={{ background: DARK_PALETTE_BASE.body }}>
      <div className="flex h-9 items-center justify-between px-3.5">
        <span className="font-mono text-[11px]" style={{ color: portChipStyle(type).color }}>
          {type ?? "STRING"}
        </span>
        <span className="text-ink-fainter font-mono text-[10px]">{dir}</span>
      </div>
      <PortHandle id={portId} dir={dir} type={type} />
    </div>
  );
}

/**
 * 真节点渲染器：**从 `nodeTypes` 进画布**，所以 `useNodeId()` 拿得到宿主 id、
 * `<Handle>` 走真分支。这一份刻意只放端点列 —— 它要验的就是端点本身。
 *
 * ## 端点 id 必须与真画布同口径（否则场景里的连线一条都画不出来）
 *
 * handle id **不是**随手取的短序号，而是 React Flow 找锚点的唯一凭据：
 * 找不到就会**静默丢弃整条边**（不报错、控制台干净、画布只是少几条线）。
 * 真画布上两套口径各管一侧（`FlowNodePinRows.tsx` / `WorkflowNode.tsx`）：
 *
 *  · **输出端** → `` `out:${outName}` ``（前缀常量是 `OUTPUT_PORT_HANDLE_PREFIX`）；
 *  · **输入端** → `ioKey`（这里用端口名本身，正是那份动态表单的键）。
 *
 * 所以这份渲染器的 `id` 与 `flow-canvas.tsx` 场景里每条边的
 * `sourceHandle` / `targetHandle` 是**对着写的**，改一侧必须同批改另一侧。
 * 判据 `tests/storybook-injection-layers.test.ts` 按两侧交集现算，不靠人记。
 */
function PortDemoNode() {
  /* 十行 = 把两套 id 口径各显一遍（输入 = `ioKey`，输出 = `out:<name>`），也正是
     `flow-canvas.tsx` 那几档场景的边引用到的全部端口。
     代价是这张卡**比框架（`CANVAS_FRAME_CLASS`，560px）高** —— 所以摆它的三份
     story 都传 `fit` 让 React Flow 缩到装得下。不传的话下沿会把最后一张卡切掉，
     而构建 / tsc / eslint 全绿、只有画布上少一截（真浏览器量过：`fanOut` 切 151px、
     `twoNodes` 切 79px、`mixedKinds` 切 51px）。 */
  const rows = useMemo(
    () => [
      {
        id: "model",
        dir: /* SAFETY: 类型断言已复核 */ "in" as const,
        type: "MODEL",
      },
      {
        id: "out:model",
        dir: /* SAFETY: 类型断言已复核 */ "out" as const,
        type: "MODEL",
      },
      {
        id: "vae",
        dir: /* SAFETY: 类型断言已复核 */ "in" as const,
        type: "VAE",
      },
      {
        id: "out:vae",
        dir: /* SAFETY: 类型断言已复核 */ "out" as const,
        type: "VAE",
      },
      {
        id: "clip",
        dir: /* SAFETY: 类型断言已复核 */ "in" as const,
        type: "CLIP",
      },
      {
        id: "out:clip",
        dir: /* SAFETY: 类型断言已复核 */ "out" as const,
        type: "CLIP",
      },
      {
        id: "images",
        dir: /* SAFETY: 类型断言已复核 */ "in" as const,
        type: "IMAGE",
      },
      {
        id: "out:images",
        dir: /* SAFETY: 类型断言已复核 */ "out" as const,
        type: "IMAGE",
      },
      {
        id: "text",
        dir: /* SAFETY: 类型断言已复核 */ "in" as const,
        type: "STRING",
      },
      {
        id: "out:text",
        dir: /* SAFETY: 类型断言已复核 */ "out" as const,
        type: "STRING",
      },
    ],
    [],
  );
  return (
    <div
      className="w-80 rounded-[14px] py-2"
      style={{
        background: DARK_PALETTE_BASE.body,
        border: `1px solid ${DARK_PALETTE_BASE.borderFallback}`,
      }}
    >
      <div
        className="mb-1 px-3.5 font-mono text-[11px]"
        style={{ color: DARK_PALETTE_BASE.dotFallback }}
      >
        KSampler（真画布 · node id 可读）
      </div>
      {rows.map((row) => (
        <div key={row.id} className="relative">
          <div className="flex h-9 items-center justify-between px-3.5">
            <span
              className="font-mono text-[11px]"
              style={{ color: portChipStyle(row.type).color }}
            >
              {row.type}
            </span>
            <span className="text-ink-fainter font-mono text-[10px]">{row.dir}</span>
          </div>
          <PortHandle id={row.id} dir={row.dir} type={row.type} />
        </div>
      ))}
    </div>
  );
}

const NODE_TYPES = { story: PortDemoNode };

/** 真画布里的端点：`useNodeId()` 拿到宿主 id，`<Handle>` 真渲染（能连线的那一档）。
 *
 * `fit`：这份卡片渲染器（十行端点）比框架高，交给 React Flow 自己缩到框里 ——
 * 缩放不是这一档的被测对象（要看的是端点几何与连线），装得下才算摆对。 */
export const InCanvas: Story = {
  /* 这份 story 走 `render` 摆整块画布；`args` 由 meta 兜底（单枚端点的旋钮）。 */
  render: () => (
    <div className="flex flex-wrap gap-6 p-4">
      <StorybookFlowCanvas
        scene={withNodeType(canvasScene("twoNodes"), "story")}
        nodeTypes={NODE_TYPES}
        fit
      />
    </div>
  ),
};

/**
 * **画布外**（没有 node 上下文）：同一个组件退化成几何完全一致的装饰圆点 ——
 * IO 预览面板 / 工作流库预览复用同一行部件时就是这个形态（`data-port-dot` 仍在，
 * 库内只读连线靠它量圆心）。
 */
export const OutsideCanvas: Story = {
  render: () => (
    <div className="flex flex-col gap-2 p-4">
      <p className="text-ink-muted text-xs">
        画布外：没有 node 上下文 → 几何一致的装饰圆点（`data-port-dot` 仍在）
      </p>
      {/* 不 `overflow-hidden`：端点半圆**骑在边框上、露在卡片外**，裁了就只剩
          内半边（与画布节点的 `overflow-hidden` 包一层 `absolute inset-0` 兄弟层
          是同一个原因 —— 卡片自己 overflow 裁的必须是内容，不是端点）。 */}
      <div
        className="w-80 rounded-[14px]"
        style={{ border: `1px solid ${DARK_PALETTE_BASE.borderFallback}` }}
      >
        {PORT_ROWS.map((row) => (
          <PortRow key={row.id} portId={row.id} dir={row.dir} type={row.type} />
        ))}
      </div>
    </div>
  ),
};

/** 单枚端点（Args 面板上转 `dir` / `type`）：退化档下逐档对比类型色。 */
export const Single: Story = {
  render: () => (
    <div className="flex flex-wrap items-start gap-4 p-4">
      {PORT_ROWS.map((row) => (
        <div key={row.id} className="flex flex-col items-center gap-1">
          <div className="w-45">
            <PortRow portId={row.id} dir={row.dir} type={row.type} />
          </div>
          <span className="text-ink-muted text-2xs font-mono">
            {row.dir} · {row.type ?? "STRING"}
          </span>
        </div>
      ))}
    </div>
  ),
};

/**
 * 扇出画布（一个源节点出三条线）：端点几何在**同一节点的多个 handle** 上都成立 ——
 * 单线场景看不出这件事（连线从哪个 handle 出、落哪个 handle 上，只有真画布算得出）。
 *
 * `fit` 同上（这一档是四张卡，不缩就把最下面那张切掉一半）。
 */
export const FanOutCanvas: Story = {
  render: () => (
    <div className="flex flex-wrap gap-6 p-4">
      <StorybookFlowCanvas
        scene={withNodeType(canvasScene("fanOut"), "story")}
        nodeTypes={NODE_TYPES}
        fit
      />
    </div>
  ),
};

/**
 * 各 kind 混排（八张节点）：端点类型色的**分辨率** —— 单张节点只出一种色，
 * 「多类型并排时能不能分辨」是画布上才看得出来的那一维。
 *
 * `fit` 同上（八张卡分三行，不缩的话整个第三行都在框外）。
 */
export const MixedKindsCanvas: Story = {
  render: () => (
    <div className="flex flex-wrap gap-6 p-4">
      <StorybookFlowCanvas
        scene={withNodeType(canvasScene("mixedKinds"), "story")}
        nodeTypes={NODE_TYPES}
        fit
      />
    </div>
  ),
};
