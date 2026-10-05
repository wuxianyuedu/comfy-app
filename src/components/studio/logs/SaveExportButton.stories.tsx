import type { Meta, StoryObj } from "@storybook/nextjs";

import { SaveExportButton } from "~/components/studio/logs/SaveExportButton";
import { useLogPanel } from "~/components/studio/logs/LogProvider";

/**
 * 「保存到本机 `log/exports/`」按钮（第三层注入 · store 的现场）。
 *
 * 它自己从 store 取 `saveExport` action（这是 props 给不了的东西），所以 story
 * 走 `parameters.storeScene` 先把时间线写进 store。按钮的**成败回执是按钮本地
 * 自持**的 —— 那正是这份 story 要摆的两档：
 *
 *  · **成功**：按钮改口「已保存」并在旁边标出 `log/exports/<名>.txt`（那句路径
 *    就是排障现场要的「文件在哪」）；
 *  · **失败**：改口「保存失败」——**不谎报成功**，否则用户会去一个不存在的路径找文件。
 *
 * 画布上默认看到的是**初始态**（没点过）。真去点它需要服务端在跑（跨源那道门槛
 * 与 `data-sources.tsx` 的 tRPC 一节同源），所以这支按钮的成败回执以「初始态 +
 * 悬停提示说清存下来的是哪一类」为主 —— 那正是它在真机上大多数时候的样子。
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
