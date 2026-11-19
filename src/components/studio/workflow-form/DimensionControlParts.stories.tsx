import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import {
  CLARITY_HINT,
  GROUPED_SIZE_MAX,
  RequiredChips,
  SizeTableFooter,
} from "~/components/studio/workflow-form/DimensionControlParts";
import type { EnrichedWidget } from "~/components/studio/workflow-io-groups";

/** 组合参数（尺寸/视频）弹层附属件。RequiredChips 是必填/显隐控制：grouped 行替代独立参数行，
 * 原必填/可选徽标与 👁 会消失 —— 这里按 pin 补回。只给 onRequiredChange → 只渲染必填/可选；
 * 再给 visibilityMode + onVisibilityChange → 追加 👁；两者都不给 → 整件不渲染；
 * 多模式作者态 → required 按 mode 解析（条目级或模式覆盖层）。历史根因：原实现直读 pin.required
 * 与模式覆盖层错层，表现「点完不回读」。data-dimension-pin 是定位依据，pin 名写成真机值。 */
const pin = (over: Partial<EnrichedWidget> & { ioKey: string }): EnrichedWidget => ({
  direction: "input",
  kind: "widget",
  nodeId: "5",
  name: over.ioKey.split(":")[1] ?? "width",
  control: "int",
  ...over,
});

const WIDTH = pin({
  ioKey: "5:width",
  label: "宽度",
  type: "INT",
  required: true,
});
const HEIGHT = pin({
  ioKey: "5:height",
  label: "高度",
  type: "INT",
  required: false,
});

/** 一个带模式覆盖层的 pin：`turbo` 下变必填、`draft` 下隐藏。 */
const STEPS = pin({
  ioKey: "3:steps",
  nodeId: "3",
  label: "步数",
  type: "INT",
  required: false,
  modeOverrides: { turbo: { required: true }, draft: { visible: false } },
});

const meta = {
  title: "Studio/DimensionControlParts",
  component: RequiredChips,
  args: {
    pins: [WIDTH, HEIGHT],
    onRequiredChange: () => undefined,
  },
} satisfies Meta<typeof RequiredChips>;

export default meta;

type Story = StoryObj<typeof meta>;

/** 只补必填（没有 IO 编辑态）：只有「必填 / 可选」两态按钮。 */
export const RequiredOnly: Story = {};

/** 必填 + 显隐：追加 👁 / 👁‍🗨（`visibilityMode` 给了才渲染那一档）。 */
export const RequiredAndVisibility: Story = {
  args: {
    visibilityMode: "turbo",
    onVisibilityChange: () => undefined,
  },
};

/**
 * 两者都不给 → **整件不渲染**。这是「编辑态之外它不该出现」那条约定的样子：
 * 下面那行注解右边应当是空的，不是漏了什么。
 */
export const NotEditableRendersNothing: Story = {
  args: { onRequiredChange: undefined },
  render: (args) => (
    <div className="flex items-center gap-3">
      <span className="text-ink-muted font-mono text-[11px]">两个回调都不传 →</span>
      <span className="border-border text-ink-faint rounded border border-dashed px-3 py-1 text-[11px]">
        <RequiredChips {...args} />
      </span>
    </div>
  ),
};

/**
 * 同一批 pin 在两种 mode：STEPS 在 turbo 下变必填、在 draft 下隐藏。这一档是历史根因现场 ——
 * 必填/显隐必须按当前 mode 解析（resolveEntryRequired / isVisibleInMode）；直读条目级字段
 * 会永远显示同一档，界面上就像「点了没反应」。
 */
export const ModeOverrides: Story = {
  render: () => (
    /* SAFETY: 类型断言已复核 */
    <div className="flex flex-col gap-4">
      {([null, "turbo", "draft"] as const).map((mode) => (
        <div className="flex flex-col gap-1" key={String(mode)}>
          <span className="text-ink-muted font-mono text-[11px]">
            mode = {mode ?? "（条目级）"}
          </span>
          <div className="bg-canvas border-border-strong w-80 rounded-lg border p-2">
            <RequiredChips
              mode={mode}
              onRequiredChange={() => undefined}
              onVisibilityChange={() => undefined}
              pins={[WIDTH, STEPS]}
              visibilityMode={mode}
            />
          </div>
        </div>
      ))}
    </div>
  ),
};

/**
 * 尺寸表脚注：`scene` 决定「当前场景」提示与尺寸表入口（生图走图片场景、
 * 视频走行业标准场景）。两档并排，因为这处的措辞随场景变。
 */
export const SizeTableFooters: Story = {
  render: () => (
    /* SAFETY: 类型断言已复核 */
    <div className="flex flex-col gap-6">
      {(["image", "video"] as const).map((scene) => (
        <div className="flex flex-col gap-1" key={scene}>
          <span className="text-ink-muted font-mono text-[11px]">scene = {scene}</span>
          <div className="border-border-strong w-96 rounded-lg border p-2">
            <SizeTableFooter onOpen={() => undefined} scene={scene} />
          </div>
        </div>
      ))}
      <p className="text-ink-muted font-mono text-[11px]">
        尺寸上界 GROUPED_SIZE_MAX = {String(GROUPED_SIZE_MAX)} · 两个子类的说明：
        {Object.entries(CLARITY_HINT)
          .map(([k, v]) => `${k}=${v}`)
          .join(" / ")}
      </p>
    </div>
  ),
};
