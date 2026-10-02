import type { Meta, StoryObj } from "@storybook/nextjs";

import { SourceTag } from "~/components/ui/source-tag";

/**
 * 「这一条工作流从哪来」：`local` 已连磁盘 / 在线只在 DB。两档色走语义
 * token（`local` 用比 `tone.success` 稍强一档的 `bg-success/12`），所以
 * 这一屏同时是「改 token 后两档跟不跟得上」的对照面。
 */
const meta = {
  title: "UI/SourceTag",
  component: SourceTag,
  args: { source: "workflow.json", local: true },
} satisfies Meta<typeof SourceTag>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Both: Story = {
  render: () => (
    <div className="flex items-center gap-2">
      <SourceTag source="workflow.json" local />
      <SourceTag source="workflow.json" local={false} />
    </div>
  ),
};

/** `local` 未给时看 `source === "local"` 那条兜底分支。 */
export const FallbackBySource: Story = {
  render: () => (
    <div className="flex items-center gap-2">
      <SourceTag source="local" />
      <SourceTag source="api" />
      <SourceTag />
    </div>
  ),
};
