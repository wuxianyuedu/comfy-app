import type { Meta, StoryObj } from "@storybook/nextjs";

import { SeedModeButton } from "~/components/ui/seed-mode-button";

/**
 * `SeedModeButton` 是画布节点上那颗「控件后行为」chip（ComfyUI 的 `control_after_generate` 四选项面板）。它没有数据依赖：入参只有 `mode: string | undefined` 与 `onPick`。
 * 要看四档图标（固定 = 图钉 / 递增 / 递减 = 上下箭头 / 随机 = 骰子）：纯几何 SVG，配色走 `--color-seed-*`（规范 03 §3.6.1 类型色例外），缺 token 时图标会静默变成黑块 + 隐形箭头。
 */
type SeedMode = "fixed" | "increment" | "decrement" | "random";

const MODES: Array<SeedMode> = ["fixed", "increment", "decrement", "random"];

const meta = {
  title: "UI/SeedModeButton",
  component: SeedModeButton,
  /* `onPick` 是必填回调（真机上由画布层写回节点的 `seedModes`）——
     它的位置在 Args 里可由 Storybook 的 action 面板替下来，但类型上是必填的，
     所以给一个显式空实现而不是省略它。 */
  args: { mode: "fixed", onPick: () => undefined },
  argTypes: {
    mode: { control: { type: "select" }, options: MODES },
    onPick: { description: "由画布层写回节点的 `seedModes` 映射" },
  },
} satisfies Meta<typeof SeedModeButton>;

export default meta;

type Story = StoryObj<typeof meta>;

/** 默认：`fixed`（图钉），也是 `mode` 缺失时回显的那一档。 */
export const Default: Story = {};

/** 四档并排：颜色与图形各自表达一种行为，四个都要能看清。 */
export const AllModes: Story = {
  render: () => (
    <div className="flex flex-col gap-3">
      {MODES.map((mode) => (
        <div className="flex items-center gap-3" key={mode}>
          <span className="text-ink-muted w-20 font-mono text-[11px]">{mode}</span>
          <SeedModeButton mode={mode} onPick={() => undefined} />
        </div>
      ))}
    </div>
  ),
};

/** `mode` 为 `undefined` 时的回显（新节点还没设过这一档）。 */
export const Unset: Story = {
  args: { mode: undefined },
};

/**
 * 展开后的面板：四行（图标 + 标题 + 两行提示）与右侧单选圆点。hover 展开由 Popover 基元负责（portal
 * 到 body），story 这里画不进去 —— 做法是把四个档位各画一颗、按真机行间距堆起来看形态；真正的展开面板
 * 请在画布上点开（Popover 基元的 story 在 `ui/popover`）。
 */
export const InCanvasRow: Story = {
  render: () => (
    /* SAFETY: 类型断言已复核 */
    <div className="border-border-subtle bg-canvas-deep flex w-80 items-center gap-2 rounded-lg border p-2.5">
      <span className="text-ink-muted text-[11px]">seed</span>
      <span className="border-border-strong bg-canvas-deep text-ink-soft flex-1 rounded-md border px-2 py-0.5 font-mono text-[11px]">
        486920135724881
      </span>
      {([null, ...MODES] as const).map((mode) => (
        <SeedModeButton key={mode ?? "unset"} mode={mode ?? undefined} onPick={() => undefined} />
      ))}
    </div>
  ),
};
