import type { Meta, StoryObj } from "@storybook/nextjs";

import { SeedModeButton } from "~/components/ui/seed-mode-button";

/**
 * `SeedModeButton` 是画布节点上那颗「控件后行为」chip（ComfyUI 的
 * `control_after_generate` 四选项面板）。
 *
 * **它根本没有数据依赖**：入参只有 `mode: string | undefined` 与 `onPick`。
 * 此前把它归进「有数据依赖」那一批是**误判** —— 它的门槛只有一条：
 * 触发器的**当前值回显**要看得出来是哪一档，而这一点用一个字面量联合就够了。
 *
 * 要看的是四档图标（固定 = 图钉 / 递增 / 递减 = 上下箭头 / 随机 = 骰子）：
 * 它们是**纯几何 SVG**，配色走 `--color-seed-*` 一组 token（规范 03 §3.6.1 的
 * 「类型色例外」）—— 缺一份 token 定义时图标会静默变成黑块 + 隐形箭头，
 * 所以这里四档都要能看见。
 *
 * 枚举从 props 派生（`mode` 是 `string | undefined`，故清单按组件内的
 * `SEED_MODES` 四档手写一份 —— 它的取值范围由 ComfyUI 协议定，不从 cva 取）。
 */
type SeedMode = "fixed" | "increment" | "decrement" | "random";

const MODES: SeedMode[] = ["fixed", "increment", "decrement", "random"];

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
        <div key={mode} className="flex items-center gap-3">
          <span className="text-ink-muted w-20 font-mono text-[11px]">
            {mode}
          </span>
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
 * 展开后的面板：**四行**（含图标 + 标题 + 两行提示）与右侧单选圆点。
 *
 * hover 之后展开由 Popover 基元负责，story 这里把面板本身画出来看形态
 * 是做不到的（它 portal 到 body）—— 所以这条 story 的做法是**把四个档位各画一颗**
 * 并按真机的行间距堆起来，看得见「同一套行在四档下的差别」。
 * 真正的展开面板请在画布上点开（那是 Popover 基元的事，它的 story 在
 * `ui/popover`）。
 */
export const InCanvasRow: Story = {
  render: () => (
    <div className="border-border-subtle bg-canvas-deep flex w-80 items-center gap-2 rounded-lg border p-2.5">
      <span className="text-ink-muted text-[11px]">seed</span>
      <span className="border-border-strong bg-canvas-deep text-ink-soft flex-1 rounded-md border px-2 py-0.5 font-mono text-[11px]">
        486920135724881
      </span>
      {([null, ...MODES] as const).map((mode) => (
        <SeedModeButton
          key={mode ?? "unset"}
          mode={mode ?? undefined}
          onPick={() => undefined}
        />
      ))}
    </div>
  ),
};
