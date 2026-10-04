import type { Meta, StoryObj } from "@storybook/nextjs";

import { Checkbox } from "~/components/ui/checkbox";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSeparator,
  FieldSet,
  FieldTitle,
} from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import { Switch } from "~/components/ui/switch";

/**
 * `ui/field` 是 shadcn 的**字段布局族**（`FieldSet` / `Field` / `FieldLabel` /
 * `FieldError` …），它只管**行内部**标签 / 控件 / 说明 / 错误四件的位置关系与
 * 容器查询下的响应式排布，不判校验、不管布局（见 `field.tsx` 的文件头）。
 *
 * 这一族此前没有 story 的原因不是「有数据依赖」——它是**纯 props**。
 * 真正的原因是没有 `FieldLegend` / `variant` 这些形态的现场：整族的价值在
 * 「四个部件拼在一起对不对」，单看一个 `Field` 只是个 `div`。所以这里的 story
 * 都按**真实落点的拼法**给（设置页的三件套、画布节点的勾选行…）。
 *
 * 枚举从 props 派生（不从任何变体表的返回值上取，规范 16 §16.2.3.4）。
 */
type FieldOrientation = NonNullable<
  React.ComponentProps<typeof Field>["orientation"]
>;
type FieldLegendVariant = NonNullable<
  React.ComponentProps<typeof FieldLegend>["variant"]
>;

const ORIENTATIONS: FieldOrientation[] = [
  "vertical",
  "horizontal",
  "responsive",
];
const LEGEND_VARIANTS: FieldLegendVariant[] = ["legend", "label"];

const meta = {
  title: "UI/Field",
  component: Field,
  args: { orientation: "vertical" },
  argTypes: {
    orientation: { control: { type: "select" }, options: ORIENTATIONS },
  },
} satisfies Meta<typeof Field>;

export default meta;

type Story = StoryObj<typeof meta>;

/** 三档排布：`vertical`（默认）/ `horizontal`（标签与控件同行）/
 *  `responsive`（容器查询下自动换行 —— 要拖窄画布才看得出差别）。 */
export const Orientations: Story = {
  render: () => (
    <div className="flex w-xl flex-col gap-6">
      {ORIENTATIONS.map((orientation) => (
        <div key={orientation} className="flex flex-col gap-1.5">
          <span className="text-ink-muted font-mono text-[11px]">
            orientation={orientation}
          </span>
          <Field orientation={orientation}>
            <FieldLabel htmlFor={`name-${orientation}`}>模型名称</FieldLabel>
            <Input
              id={`name-${orientation}`}
              placeholder="例如 sd_xl_base_1.0"
            />
          </Field>
        </div>
      ))}
    </div>
  ),
};

/** 完整的一组：图例 + 说明 + 两个字段 + 分隔线。这是设置页表单的真实拼法。 */
export const GroupedSet: Story = {
  render: () => (
    <FieldSet className="w-xl">
      <FieldLegend>输出设置</FieldLegend>
      <FieldDescription>
        这里的取值会写进工作流模板，节点上的同名字段以节点为准。
      </FieldDescription>
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="field-width">宽度</FieldLabel>
          <Input id="field-width" defaultValue="1024" />
        </Field>
        <Field>
          <FieldLabel htmlFor="field-height">高度</FieldLabel>
          <Input id="field-height" defaultValue="1024" />
        </Field>
      </FieldGroup>
      <FieldSeparator>高级</FieldSeparator>
      <FieldGroup>
        <Field orientation="horizontal">
          <FieldContent>
            <FieldTitle>同时写出元数据</FieldTitle>
            <FieldDescription>落盘时写一份同名的 .json</FieldDescription>
          </FieldContent>
          <Switch defaultChecked />
        </Field>
      </FieldGroup>
    </FieldSet>
  ),
};

/** 错误行：`data-invalid` 上色、`FieldError` 承载 `role="alert"`。 */
export const WithError: Story = {
  render: () => (
    <FieldSet className="w-xl">
      <FieldLegend variant="label">两态并列</FieldLegend>
      <FieldGroup>
        <Field data-invalid="true">
          <FieldLabel htmlFor="field-bad">提示词</FieldLabel>
          <Input id="field-bad" defaultValue="" aria-invalid />
          <FieldError>提示词不能为空</FieldError>
        </Field>
        <Field>
          <FieldLabel htmlFor="field-good">负向提示词</FieldLabel>
          <Input id="field-good" defaultValue="watermark" />
          {/* `FieldError` 不判校验（那是 schema 的事）—— 给它 `errors` 它就渲染，
              所以「这行没有错」的现场是**不传** `errors`。 */}
          <FieldError />
        </Field>
      </FieldGroup>
    </FieldSet>
  ),
};

/**
 * `FieldError` 的三条路径：单条错误直接出文、多条折成 `<ul>`、`children` 优先。
 * 它是 `field.tsx` 里唯一有逻辑（去重）的部件，值得单看。
 */
export const ErrorShapes: Story = {
  parameters: { layout: "centered" },
  render: () => (
    <div className="flex flex-col gap-4">
      <FieldError errors={[{ message: "单条：直接出文" }]} />
      <FieldError
        errors={[
          { message: "重复的一条" },
          { message: "重复的一条" },
          { message: "另一条" },
        ]}
      />
      <FieldError errors={[{ message: "这个不会出现" }]}>
        传了 children 时它优先
      </FieldError>
      {/* 空数组 / 全是 undefined 时整行不渲染（`content` 为 null） */}
      <FieldError errors={[]} />
      <FieldError errors={[undefined]} />
    </div>
  ),
};

/** 勾选行：`FieldLabel` 包住 `<Checkbox>` 时整行可点，是画布节点的常见形态。 */
export const SelectionRow: Story = {
  render: () => (
    <FieldGroup className="w-xl">
      {["本地模型", "工作流库", "项目产物"].map((label, index) => (
        <FieldLabel key={label} htmlFor={`pick-${String(index)}`}>
          <Field orientation="horizontal">
            <Checkbox
              id={`pick-${String(index)}`}
              defaultChecked={index === 0}
            />
            <FieldContent>
              <FieldTitle>{label}</FieldTitle>
              <FieldDescription>扫这个来源下的条目</FieldDescription>
            </FieldContent>
          </Field>
        </FieldLabel>
      ))}
    </FieldGroup>
  ),
};

/** `FieldLegend` 两档字号：`legend`（区块标题）/ `label`（与字段标签同档）。 */
export const LegendVariants: Story = {
  render: () => (
    <div className="flex flex-col gap-3">
      {LEGEND_VARIANTS.map((variant) => (
        <FieldSet key={variant}>
          <FieldLegend variant={variant}>{variant}</FieldLegend>
          <FieldDescription>同一句说明在两档下的关系</FieldDescription>
        </FieldSet>
      ))}
    </div>
  ),
};
