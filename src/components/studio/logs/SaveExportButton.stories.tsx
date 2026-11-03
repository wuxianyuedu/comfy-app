import type { Meta, StoryObj } from "@storybook/nextjs";

import { SaveExportButton } from "~/components/studio/logs/SaveExportButton";
import { useLogPanel } from "~/components/studio/logs/LogProvider";

/**
 * 「保存到本机 `log/exports/`」按钮（第三层注入 · store 的现场）：它自己从 store 取 `saveExport`，
 * story 用 `parameters.storeScene` 先写入时间线。回执本地自持两档：成功改口「已保存」并标出
 * `log/exports/<名>.txt`、失败改口「保存失败」（不谎报）。真点需服务端在跑，画布以初始态 + 悬停提示为主。
 */
const meta = {
  title: "Studio/Logs/SaveExportButton",
  component: SaveExportButton,
  parameters: { storeScene: "mixed" },
} satisfies Meta<typeof SaveExportButton>;

export default meta;

/** 类型取自适配件（`total` 由 store 现算，不手抄）。 */
type Story = StoryObj<typeof SaveExportHarness>;

/**
 * 适配件：`total` 从真切片里读（与面板行头上那枚用的是**同一个**数）。
 * 手抄一个 `total: 12` 会在日志条数变化后继续显示旧值，而画布看着正常。
 */
function SaveExportHarness() {
  const header = useLogPanel((state) => state.header);
  return (
    <div className="border-border-strong bg-surface-1 flex items-center gap-1 rounded-md border px-3 py-2">
      <SaveExportButton
        label="launcher"
        scopeLabel="启动器 · 全部级别"
        total={header.filteredLogs.length}
      />
    </div>
  );
}

/** 默认（`mixed`）：初始态，悬停提示写明存下来的是哪一类、多少条。 */
export const Default: Story = {
  render: () => <SaveExportHarness />,
};

/** 空时间线：`0` 条时它照样可点（存一个只有表头的文件也是有效的操作）。 */
export const Empty: Story = {
  parameters: { storeScene: "empty" },
  render: () => <SaveExportHarness />,
};

/**
 * 2600 条：`total` 是四位数时按钮的悬停提示（存下来的是一整页，不是全部）。
 */
export const LongTimeline: Story = {
  parameters: { storeScene: "longTimeline" },
  render: () => <SaveExportHarness />,
};
