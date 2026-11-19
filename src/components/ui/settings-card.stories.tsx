import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { SettingsCard } from "~/components/ui/settings-card";

/**
 * `SettingsCard` 是设置页 11 个段落共用的「有标题卡片」唯一出口，与 `ui/card` 是薄封装、不是平行实现：底色 / 圆角 / 边框 / 内边距全走官方 `Card` 与语义 token。
 * 本件只补两件事 —— 必填字符串标题（自己拼 `CardHeader + CardTitle`）与外观微调（`rounded-2xl` + `shadow-sm` + `backdrop-blur`，均为中性 utility）。story 验的是「设置页那一段长什么样」。
 */
const meta = {
  title: "UI/SettingsCard",
  component: SettingsCard,
  args: { title: "存储目录", children: null },
} satisfies Meta<typeof SettingsCard>;

export default meta;

type Story = StoryObj<typeof meta>;

/** 真实落点：一整段设置项（标题 + 说明 + 控件）。 */
export const Default: Story = {
  render: (args) => (
    <SettingsCard {...args} className="w-120">
      <p className="text-ink-muted mb-3 text-sm">这些目录只读展示，改动需编辑仓库根的 .env。</p>
      <dl className="grid grid-cols-[6rem_1fr] gap-2 text-sm">
        <dt className="text-ink-muted">模型</dt>
        <dd className="truncate font-mono text-xs">D:/ComfyUI/models</dd>
        <dt className="text-ink-muted">输出</dt>
        <dd className="truncate font-mono text-xs">D:/ComfyUI/output</dd>
      </dl>
    </SettingsCard>
  ),
};

/** 带操作区：底部一排按钮（设置页的「保存 / 重置」）—— 它是 `children`
 *  的一部分，本件只管外框那一层。 */
export const WithActions: Story = {
  render: (args) => (
    <SettingsCard {...args} className="w-120" title="外观">
      <div className="flex flex-col gap-3">
        <Input aria-label="主题" defaultValue="深色" />
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="ghost">
            重置
          </Button>
          <Button size="sm">保存</Button>
        </div>
      </div>
    </SettingsCard>
  ),
};

/** 多段并列：设置页的真实排布是**一段接一段**，段间靠外层 `gap` ——
 *  这一条验的是「两张卡并列时边框/圆角/间距看起来是否成套」。 */
export const Stack: Story = {
  render: () => (
    <div className="flex w-120 flex-col gap-4">
      <SettingsCard title="通用">
        <p className="text-ink-muted text-sm">启动时自动检查更新。</p>
      </SettingsCard>
      <SettingsCard title="执行">
        <p className="text-ink-muted text-sm">并发上限 3 个任务。</p>
      </SettingsCard>
    </div>
  ),
};
