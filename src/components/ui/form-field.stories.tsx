import type { Meta, StoryObj } from "@storybook/nextjs";

import { FormField } from "~/components/ui/form-field";
import { Input } from "~/components/ui/input";
import { SelectMenu } from "~/components/ui/select-menu";

/**
 * `FormField` 是「标签 + 控件 + 校验错误」的三件套（规范 16 §16.2.4.26）。
 *
 * 它的入参里 `label` / `hint` / `children` **都可以是 ReactNode**，`children`
 * 还支持 render-prop（`(a11y) => <Input {...a11y} />`）—— 这正是它此前没 story 的
 * 真实原因：Args 面板装不下 React 节点。按注入层的口径，这类参数由 story 的
 * `render` 给，Args 里只留可调的布尔与文案（见 `.storybook/data-sources.tsx`）。
 *
 * 要看的是 **ARIA 关联**（`htmlFor` / `aria-invalid` / `aria-describedby`）
 * 与「错误行比 hint 更靠下」这个阅读顺序 —— 两者都有单测（`form-field.test.tsx`），
 * 这里看的是**形态**：它们拼在一起时的间距与层级对不对。
 */
const meta = {
  title: "UI/FormField",
  component: FormField,
  args: {
    label: "工作流名称",
    id: "wf-name",
    required: false,
  },
  argTypes: {
    label: { control: { type: "text" } },
    hint: { control: { type: "text" } },
    error: { control: { type: "text" } },
  },
  render: (args) => (
    <div className="w-96">
      <FormField {...args}>
        {(a11y) => <Input {...a11y} placeholder="例如 角色一致性 · 三视图" />}
      </FormField>
    </div>
  ),
} satisfies Meta<typeof FormField>;

export default meta;

type Story = StoryObj<typeof meta>;

/** 常态：标签 + 控件（render-prop 把 ARIA 属性接到真控件上）。 */
export const Default: Story = {};

/** 带常驻说明：`hint` 在控件下方、错误行**之上**（先解释、再报错）。 */
export const WithHint: Story = {
  args: { hint: "同名工作流会被覆盖，保存在工作流库里。" },
};

/** 必填：标签右侧一颗 `*`（无错误时的静态标记）。 */
export const Required: Story = {
  args: { required: true },
};

/** 错误态：`aria-invalid` 上到控件上，错误行进 `aria-describedby`。 */
export const WithError: Story = {
  args: { error: "名称已被占用", hint: "同名工作流会被覆盖。" },
};

/**
 * 非 `input` 控件也走同一个出口：`SelectMenu` 这类不是 `<input>`，硬包一层
 * 会把它的 ARIA 契约挡掉 —— render-prop 正是为它留的。
 */
export const NonInputControl: Story = {
  render: () => (
    <div className="w-96">
      <FormField label="输出规格" id="out-size" hint="写进工作流模板">
        {(a11y) => (
          <SelectMenu
            value="1024"
            onChange={() => undefined}
            options={["512", "1024", "2048"]}
            labels={{
              "512": "512 × 512",
              "1024": "1024 × 1024",
              "2048": "2048 × 2048",
            }}
            aria-label="输出规格"
            {...a11y}
          />
        )}
      </FormField>
    </div>
  ),
};

/**
 * 只有说明文字、控件在别处：`children` 可省略（`label` 给 `null` 时不渲染标签行）。
 * 这是「行编辑器」那类落点 —— 硬要一个控件只会得到 `children={<></>}`。
 */
export const LabelOnly: Story = {
  args: {
    label: "节点级覆盖",
    hint: "这一行的取值不会写回模板。",
    id: undefined,
  },
  render: (args) => (
    <div className="w-96 border-l-2 border-dashed pl-3">
      <FormField {...args} />
    </div>
  ),
};
