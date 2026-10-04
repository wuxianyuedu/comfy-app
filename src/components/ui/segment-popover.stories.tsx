import type { Meta, StoryObj } from "@storybook/nextjs";

import {
  MultiSegmentPopover,
  RatioIcon,
  shortRatioLabel,
  type SegmentSection,
} from "~/components/ui/segment-popover";
import {
  ALIGN_MULTIPLE_OPTIONS,
  MEGAPIXEL_TIERS,
  RESOLUTION_TIERS,
  SIZE_RATIO_PRESETS,
} from "~/lib/media/size-presets";

/**
 * `MultiSegmentPopover` 是「一组参数一次选完」的下拉面板（比例 / 像素 / 倍数）。
 *
 * 和 `OptionListPopover` 一样，它**没有数据依赖** —— `sections` 是纯数据、
 * 回调由调用处给。此前没 story 的原因只有一条：`triggerContent` / `opt.render` /
 * `footer` 都是 ReactNode，Args 面板装不下。按注入层的口径，那几项由 story 的
 * `render` 给。
 *
 * 要看的是「分段内单选」这件事：每一段内部互斥、段与段并排；分段下的**子分组**
 * 各占一行（分辨率与百万像素是两族，混在一行会看不出它们的单位不同）。
 * 数据用真的预设表（`~/lib/media/size-presets`）而不是手抄一份 —— 抄一份就等于
 * 让 story 与真机漂移。
 */
const RATIO_OPTIONS = SIZE_RATIO_PRESETS.map((preset) => ({
  value: preset.label,
  label: shortRatioLabel(preset.label),
  render: <RatioIcon ratio={preset.ratio} />,
}));

const RESOLUTION_OPTIONS = RESOLUTION_TIERS.map((tier) => ({
  value: tier,
  label: tier.toUpperCase(),
  subgroup: "分辨率",
}));

const MEGAPIXEL_OPTIONS = MEGAPIXEL_TIERS.map((tier) => ({
  value: `${String(tier)}M`,
  label: `${String(tier)}M`,
  subgroup: "百万像素",
}));

/** 这一族 story 的 Args：只看**能序列化**的那部分（面板形态由代码给）。 */
type StoryArgs = {
  /** 触发器上折成一行的那句摘要（真机上是「16:9 / 2K」这种）。 */
  summary: string;
  /** 面板里画几段（比例一段、像素一段、倍数一段）。 */
  sectionCount: 1 | 2 | 3;
  /** 面板宽窄两档：窄档要在画布节点里也放得下。 */
  align: "left" | "right";
  disabled?: boolean;
};

/** 按真机的拼法把段拼出来（`DimensionControl` 的 `sections` 同形）。 */
function buildSections(count: 1 | 2 | 3): SegmentSection<string>[] {
  const list: SegmentSection<string>[] = [
    {
      label: "比例",
      value: "16:9 横屏",
      options: RATIO_OPTIONS,
      onChange: () => undefined,
    },
  ];
  if (count >= 2) {
    list.push({
      label: "像素",
      value: "2k",
      options: [...RESOLUTION_OPTIONS, ...MEGAPIXEL_OPTIONS],
      onChange: () => undefined,
    });
  }
  if (count >= 3) {
    list.push({
      label: "倍数",
      value: "64",
      options: ALIGN_MULTIPLE_OPTIONS.map((option) => ({
        value: String(option),
        label: String(option),
      })),
      onChange: () => undefined,
    });
  }
  return list;
}

function SegmentWithSummary({
  summary,
  sectionCount,
  align,
  disabled,
}: StoryArgs) {
  return (
    <div className="w-72">
      <MultiSegmentPopover
        ariaLabel="选择比例与像素"
        triggerContent={summary}
        sections={buildSections(sectionCount)}
        align={align}
        disabled={disabled}
      />
    </div>
  );
}

const meta = {
  title: "UI/MultiSegmentPopover",
  component: SegmentWithSummary,
  args: { summary: "16:9 / 2k / 64", sectionCount: 3, align: "left" },
  argTypes: {
    sectionCount: { control: { type: "inline-radio" }, options: [1, 2, 3] },
    align: { control: { type: "inline-radio" }, options: ["left", "right"] },
  },
} satisfies Meta<StoryArgs>;

export default meta;

type Story = StoryObj<typeof meta>;

/** 真机上的完整形态：三段（比例 / 像素 / 倍数），摘要折成一行。 */
export const Default: Story = {};

/** 只有一段时：面板仍走同一套壳与行，只是没有别的段可切。 */
export const SingleSection: Story = {
  args: { sectionCount: 1, summary: "16:9" },
};

/**
 * 两段：`像素` 这一段里有**两族子分组**（分辨率 1k/2k/4k 与百万像素 1M/2M/4M），
 * 它们各占一行并带小号标签 —— 混在一行会让「k」与「M」看起来是同一种单位。
 */
export const TwoSectionsWithSubgroups: Story = {
  args: { sectionCount: 2, summary: "16:9 / 2k" },
};

/** 禁用：面板不可展开（画布锁定 / 上游还没就绪）。 */
export const Disabled: Story = {
  args: { disabled: true },
};

/**
 * 带 `footer` 的形态：真机上那一格放的是「打开尺寸表」与一句当前档位的说明。
 * `footer` 是 ReactNode，所以由 story 的 `render` 给（不在 Args 里）。
 */
export const WithFooter: Story = {
  args: { align: "right" },
  render: (args) => (
    <div className="flex w-md justify-end">
      <div className="border-accent/30 bg-accent/4 w-fit max-w-full rounded-lg border p-2">
        <div className="flex items-center gap-2">
          <span className="text-accent shrink-0 text-[10px] font-semibold tracking-wider uppercase">
            比例 + 像素
          </span>
          <div className="w-40 min-w-0">
            <MultiSegmentPopover
              ariaLabel="选择比例与像素"
              triggerContent={args.summary}
              sections={buildSections(args.sectionCount)}
              align={args.align}
              footer={
                <div className="flex items-center justify-between gap-2">
                  <span className="text-ink-muted text-[11px]">
                    打开尺寸表…
                  </span>
                  <span className="text-ink-faint text-[10px]">
                    像素按长边给定
                  </span>
                </div>
              }
            />
          </div>
        </div>
      </div>
    </div>
  ),
};
