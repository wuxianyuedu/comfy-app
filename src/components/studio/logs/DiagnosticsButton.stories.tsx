import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { DiagnosticsButton } from "~/components/studio/logs/DiagnosticsButton";

/**
 * 「打包诊断现场」按钮 —— 第三层注入（store）的现场之一：它自己从 `useLogPanel` 取
 * `saveDiagnostics`，story 用 `parameters.storeScene` 先写入时间线；回执本地自持（`useFlashLatch`），
 * 成功标出 `log/exports/<名>.zip`、失败改口「打包失败」不谎报。与 `SaveExportButton` 分工刻意：
 * 那个存当前筛选的行，这个带走整份诊断现场（`run.json`、崩溃残留、comfy-cli 回执，面板上看不到）。 */
const meta = {
  title: "Studio/Logs/DiagnosticsButton",
  component: DiagnosticsButton,
  parameters: { storeScene: "mixed" },
} satisfies Meta<typeof DiagnosticsButton>;

export default meta;

type Story = StoryObj<typeof meta>;

/** 默认（`mixed`）：初始态，悬停提示写明它带走的是整份诊断现场而不是面板里的行。 */
export const Default: Story = {
  render: () => (
    <div className="bg-surface-1 border-border-strong flex items-center gap-2 rounded-md border px-3 py-2">
      <DiagnosticsButton />
    </div>
  ),
};

/** 空时间线：面板什么都没有时它照样可点（诊断带走的是磁盘现场，与面板无关）。 */
export const EmptyTimeline: Story = {
  parameters: { storeScene: "empty" },
  render: () => (
    <div className="bg-surface-1 border-border-strong flex items-center gap-2 rounded-md border px-3 py-2">
      <DiagnosticsButton />
    </div>
  ),
};
