import type { Meta, StoryObj } from "@storybook/nextjs";

import {
  CLARITY_HINT,
  GROUPED_SIZE_MAX,
  RequiredChips,
  SizeTableFooter,
} from "~/components/studio/workflow-form/DimensionControlParts";
import type { EnrichedWidget } from "~/components/studio/workflow-io-groups";

/**
 * 组合参数（尺寸 / 视频）弹层里的两件附属件。
 *
 * `RequiredChips` 是**必填 / 显隐控制**：grouped 行替代了各自的独立参数行，
 * 原来的必填/可选徽标与 👁 会跟着消失 —— 这件把它们按 pin 补回组合卡里。
 * 它的状态空间比看起来大，所以下面**逐档摆**：
 *
 *   · 只给 `onRequiredChange` → 只渲染「必填 / 可选」按钮；
 *   · 再给 `visibilityMode` + `onVisibilityChange` → 追加 👁 / 👁‍🗨；
 *   · 两者都不给 → **整件不渲染**（编辑态之外它不该出现在画布上）；
 *   · 多模式作者态 → `required` 按 `mode` 解析（读条目级 or 模式覆盖层）。
 *
 * 最后一条是有历史根因的：原实现直读条目级 `pin.required`，与写入模式覆盖层
 * 错层，表现是「点完按钮 UI 不回读，看起来像无法切换」。所以 story 里专设
 * 一档**同一批 pin 在两种 mode 下**的读数 —— 那正是这条坑的样子。
 *
 * `data-dimension-pin` 是每个 chip 的定位依据（判据与测试按它找），
 * 所以下面的 pin 名都写成真机上会出现的（`width` / `height` / `aspect` / `megapixels`）。
 */
const pin = (
  over: Partial<EnrichedWidget> & { ioKey: string },
): EnrichedWidget => ({
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
      <span className="text-ink-muted font-mono text-[11px]">
        两个回调都不传 →
      </span>
      <span className="border-border text-ink-faint rounded border border-dashed px-3 py-1 text-[11px]">
        <RequiredChips {...args} />
      </span>
    </div>
  ),
};

/**
 * 同一批 pin 在两种 mode 下：`STEPS` 在 `turbo` 下变**必填**、在 `draft` 下**隐藏**。
 *
 * 这一档就是那条历史根因的现场 —— 必填/显隐必须按当前 mode 解析
 *（`resolveEntryRequired` / `isVisibleInMode`），直读条目级字段时会永远显示
 * 同一档，而界面上看起来就像「点了没反应」。
 */
export const ModeOverrides: Story = {
  render: () => (
    <div className="flex flex-col gap-4">
      {([null, "turbo", "draft"] as const).map((mode) => (
        <div key={String(mode)} className="flex flex-col gap-1">
          <span className="text-ink-muted font-mono text-[11px]">
            mode = {mode ?? "（条目级）"}
          </span>
          <div className="bg-canvas border-border-strong w-80 rounded-lg border p-2">
            <RequiredChips
              pins={[WIDTH, STEPS]}
              mode={mode}
              visibilityMode={mode}
              onRequiredChange={() => undefined}
              onVisibilityChange={() => undefined}
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
    <div className="flex flex-col gap-6">
      {(["image", "video"] as const).map((scene) => (
        <div key={scene} className="flex flex-col gap-1">
          <span className="text-ink-muted font-mono text-[11px]">
            scene = {scene}
          </span>
          <div className="border-border-strong w-96 rounded-lg border p-2">
            <SizeTableFooter scene={scene} onOpen={() => undefined} />
          </div>
        </div>
      ))}
      <p className="text-ink-muted font-mono text-[11px]">
        尺寸上界 GROUPED_SIZE_MAX = {String(GROUPED_SIZE_MAX)} ·
        两个子类的说明：
        {Object.entries(CLARITY_HINT)
          .map(([k, v]) => `${k}=${v}`)
          .join(" / ")}
      </p>
    </div>
  ),
};
