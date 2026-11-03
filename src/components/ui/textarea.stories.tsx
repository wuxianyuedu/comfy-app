import type { Meta, StoryObj } from "@storybook/nextjs";

import { Textarea } from "~/components/ui/textarea";

/** `ui/textarea` 的形态由**原生属性**驱动 —— 无变体轴，只有三件事在视图里反复出错：① `field-sizing-content` 随内容长高
 *（不需 `rows`），但 `min-h-16` 保底，两行内看不出；② `aria-invalid` 是唯一的「错误态」入口（`aria-invalid:border-*`），
 * 与 `Field`/`FormField` 共用；③ `disabled` / 长短文案的排版：`md:text-sm` 让桌面比移动端小一档。 */
const meta = {
  title: "UI/Textarea",
  component: Textarea,
  args: { placeholder: "写点什么…", "aria-label": "提示词" },
} satisfies Meta<typeof Textarea>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: (args) => <Textarea {...args} className="w-md" />,
};

/** `field-sizing-content`：同一份 class，内容一多就长高（不需要 `rows`），
 *  但低于 `min-h-16` 时保持 64px —— 两条一起看才知道「底在哪」。 */
export const AutoGrowing: Story = {
  render: (args) => (
    <div className="flex w-md flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <span className="text-ink-muted font-mono text-[11px]">短内容（min-h-16 保底）</span>
        <Textarea {...args} aria-label="短提示词" defaultValue="一只灯塔" />
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="text-ink-muted font-mono text-[11px]">
          长内容（field-sizing-content 长高）
        </span>
        <Textarea
          {...args}
          aria-label="长提示词"
          defaultValue={
            "masterpiece, best quality, a lone lighthouse on a basalt cliff,\n" +
            "storm swell breaking below, volumetric fog, low key lighting,\n" +
            "35mm, shallow depth of field, cinematic composition"
          }
        />
      </div>
    </div>
  ),
};

/** 错误态：`aria-invalid` 同时改边框与焦点环（还有深色下的一套）。
 *  它是**唯一的**错误入口 —— 与 `ui/field` 的 `data-invalid` 是一条链。 */
export const Invalid: Story = {
  render: (args) => (
    <div className="flex w-md flex-col gap-4">
      <Textarea
        {...args}
        aria-invalid
        aria-label="错误态"
        defaultValue=""
        placeholder="提示词不能为空"
      />
      <Textarea {...args} aria-label="正常态对照" defaultValue="watermark, text, extra fingers" />
    </div>
  ),
};

/** 禁用态：`disabled:bg-input/50` + 光标说明，界面里常见于只读的参数回显。 */
export const Disabled: Story = {
  render: (args) => (
    <Textarea
      {...args}
      aria-label="只读回显"
      className="w-md"
      defaultValue="这个工作流的提示词由节点给出，不可在此修改。"
      disabled
    />
  ),
};
