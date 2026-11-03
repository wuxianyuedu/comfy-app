import type { Meta, StoryObj } from "@storybook/nextjs";
import { useMemo } from "react";

import { PortHandle, portChipStyle } from "~/components/studio/workflow-form/WorkflowPortHandle";
import { DARK_PALETTE_BASE } from "~/components/studio/canvas/workflow-node-palette";
import { StorybookFlowCanvas, canvasScene, withNodeType } from "../../../../.storybook/flow-canvas";

/** 画布端点（PortHandle）story —— 第二层注入（React Flow）的核心现场。它内部 useNodeId()，
 * 拿不到宿主 id 时 <Handle> 直接抛 error#010，故「假 provider」不是出路：真 <ReactFlow> 里长出的
 * 端点几何（骑跨卡片边框、圆心锁在子行中线）才是要看的东西；注入层 .storybook/flow-canvas.tsx 给真画布。
 * 三条：类型→颜色（IMAGE/MASK 紫、VIDEO/AUDIO 粉、STRING/INT 灰、BOOLEAN 绿、未知青，portColorFor 五分支）；
 * 进出描边不同（输入 #4D4D59、输出为卡片底色）；无 node 上下文时退化为装饰圆点且几何完全一致。 */
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
const PORT_ROWS: Array<{ dir: "in" | "out"; id: string; type?: string }> = [
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
 * 一行端点。内边距在行上、不在卡片上（与 OutputRowPort / 画布节点同一份几何）：
 * 行 relative、内容 px-3.5，于是 left/right: -6 的端点正好骑在卡片边框上；
 * 把 px-3.5 放卡片上会让端点压住标签 —— 这一层最易摆错，故 story 按真结构来。
 */
function PortRow({ portId, dir, type }: { dir: "in" | "out"; portId: string; type?: string }) {
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
      <PortHandle dir={dir} id={portId} type={type} />
    </div>
  );
}

/** 真节点渲染器：从 nodeTypes 进画布，故 useNodeId() 拿得到宿主 id、Handle 走真分支；只放端点列。
 * handle id 是 React Flow 找锚点的唯一凭据：找不到会静默丢弃整条边（不报错、画布只是少几条线）。
 * 真画布两套口径：输出端 `out:${outName}`（OUTPUT_PORT_HANDLE_PREFIX），输入端 `ioKey`（端口名本身）。
 * 本渲染器的 id 与 flow-canvas.tsx 场景里每条边的 sourceHandle/targetHandle 对着写，改一侧必须同批改另一侧；
 * tests/storybook-injection-layers.test.ts 按两侧交集现算，不靠人记。 */
function PortDemoNode() {
  /* 十行 = 把两套 id 口径各显一遍（输入 = ioKey，输出 = out:<name>），也正是 flow-canvas.tsx 场景边引用到的全部端口。
     代价是卡片比框架（CANVAS_FRAME_CLASS，560px）高 —— 故三份 story 都传 fit 让 React Flow 缩到装得下；
     不传则下沿切掉最后一张卡，而构建/tsc/eslint 全绿、只有画布少一截
     （真浏览器量过：fanOut 切 151px、twoNodes 切 79px、mixedKinds 切 51px）。 */
  const rows = useMemo(
    () => [
      {
        id: "model",
        /* SAFETY: 类型断言已复核 */
        dir: "in" as const,
        type: "MODEL",
      },
      {
        id: "out:model",
        /* SAFETY: 类型断言已复核 */
        dir: "out" as const,
        type: "MODEL",
      },
      {
        id: "vae",
        /* SAFETY: 类型断言已复核 */
        dir: "in" as const,
        type: "VAE",
      },
      {
        id: "out:vae",
        /* SAFETY: 类型断言已复核 */
        dir: "out" as const,
        type: "VAE",
      },
      {
        id: "clip",
        /* SAFETY: 类型断言已复核 */
        dir: "in" as const,
        type: "CLIP",
      },
      {
        id: "out:clip",
        /* SAFETY: 类型断言已复核 */
        dir: "out" as const,
        type: "CLIP",
      },
      {
        id: "images",
        /* SAFETY: 类型断言已复核 */
        dir: "in" as const,
        type: "IMAGE",
      },
      {
        id: "out:images",
        /* SAFETY: 类型断言已复核 */
        dir: "out" as const,
        type: "IMAGE",
      },
      {
        id: "text",
        /* SAFETY: 类型断言已复核 */
        dir: "in" as const,
        type: "STRING",
      },
      {
        id: "out:text",
        /* SAFETY: 类型断言已复核 */
        dir: "out" as const,
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
        <div className="relative" key={row.id}>
          <div className="flex h-9 items-center justify-between px-3.5">
            <span
              className="font-mono text-[11px]"
              style={{ color: portChipStyle(row.type).color }}
            >
              {row.type}
            </span>
            <span className="text-ink-fainter font-mono text-[10px]">{row.dir}</span>
          </div>
          <PortHandle dir={row.dir} id={row.id} type={row.type} />
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
        fit
        nodeTypes={NODE_TYPES}
        scene={withNodeType(canvasScene("twoNodes"), "story")}
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
          <PortRow dir={row.dir} key={row.id} portId={row.id} type={row.type} />
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
        <div className="flex flex-col items-center gap-1" key={row.id}>
          <div className="w-45">
            <PortRow dir={row.dir} portId={row.id} type={row.type} />
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
 * 扇出画布（一个源节点出三条线）：端点几何在同一节点的多个 handle 上都成立 ——
 * 单线场景看不出（连线从哪个 handle 出、落哪个上只有真画布算得出）。`fit` 同上，不缩就切掉最下面那张一半。
 */
export const FanOutCanvas: Story = {
  render: () => (
    <div className="flex flex-wrap gap-6 p-4">
      <StorybookFlowCanvas
        fit
        nodeTypes={NODE_TYPES}
        scene={withNodeType(canvasScene("fanOut"), "story")}
      />
    </div>
  ),
};

/**
 * 各 kind 混排（八张节点）：端点类型色的分辨率 —— 单张只出一种色，
 * 「多类型并排能否分辨」是画布上才看得出的维度。`fit` 同上，不缩第三行会整个在框外。
 */
export const MixedKindsCanvas: Story = {
  render: () => (
    <div className="flex flex-wrap gap-6 p-4">
      <StorybookFlowCanvas
        fit
        nodeTypes={NODE_TYPES}
        scene={withNodeType(canvasScene("mixedKinds"), "story")}
      />
    </div>
  ),
};
