import type { Meta, StoryObj } from "@storybook/nextjs";

import { NativeSelect, NativeSelectOption } from "~/components/ui/native-select";

/**
 * `ui/native-select` 是原生 `<select>` 的样式化封装（不是 base-ui Select），用于「选项很少、想省掉浮层」：原生下拉在移动端与键盘上零成本，只是样式不受主题控制。与 `ui/select` 系的分工：要受控浮层 / 富内容 / 分组 / 搜索走 select；选项固定少、走系统下拉用本件。
 * `NativeSelect` 外面包了一层 `w-fit` + 绝对定位箭头的 `div`，铺满要传外层 `className="w-full"`；两档 `size` 同时改高度与圆角（`sm` 走 `rounded-[min(var(--radius-md),10px)]`）。
 */
type NativeSelectSize = NonNullable<React.ComponentProps<typeof NativeSelect>["size"]>;

const SIZES: Array<NativeSelectSize> = ["sm", "default"];

const meta = {
  title: "UI/NativeSelect",
  component: NativeSelect,
  args: { "aria-label": "输出格式" },
} satisfies Meta<typeof NativeSelect>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: (args) => (
    <NativeSelect {...args}>
      <NativeSelectOption value="png">PNG</NativeSelectOption>
      <NativeSelectOption value="jpg">JPG</NativeSelectOption>
      <NativeSelectOption value="webp">WebP</NativeSelectOption>
    </NativeSelect>
  ),
};

/** 两档尺寸：`sm` 是 `h-7` + 更小的圆角，默认 `h-8` —— 工具条里跟 `xs`
 *  按钮并排时用 `sm`。 */
export const Sizes: Story = {
  render: (args) => (
    <div className="flex items-center gap-4">
      {SIZES.map((size) => (
        <NativeSelect key={size} {...args} size={size}>
          <NativeSelectOption value="a">size={size}</NativeSelectOption>
        </NativeSelect>
      ))}
    </div>
  ),
};

/** 铺满：`className` 落在**外层 `div`** 上（`select` 本身已经是 `w-full`），
 *  这就是上面第 1 条 —— 给错层会觉得「加了 class 没反应」。 */
export const FullWidth: Story = {
  render: (args) => (
    <div className="w-80">
      <NativeSelect {...args} className="w-full">
        <NativeSelectOption value="png">铺满父容器</NativeSelectOption>
      </NativeSelect>
    </div>
  ),
};

/** 三态：正常 / 禁用 / 错误（`aria-invalid` 走 `border-destructive`）。
 *  禁用时整块 `opacity-50` 由外层 `has-[select:disabled]:opacity-50` 接管。 */
export const States: Story = {
  render: () => (
    <div className="flex flex-col items-start gap-4">
      <NativeSelect aria-label="正常">
        <NativeSelectOption value="a">正常</NativeSelectOption>
      </NativeSelect>
      <NativeSelect aria-label="禁用" disabled>
        <NativeSelectOption value="a">禁用</NativeSelectOption>
      </NativeSelect>
      <NativeSelect aria-invalid aria-label="错误">
        <NativeSelectOption value="a">错误（aria-invalid）</NativeSelectOption>
      </NativeSelect>
    </div>
  ),
};
