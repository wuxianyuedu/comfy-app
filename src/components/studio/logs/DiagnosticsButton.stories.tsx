import type { Meta, StoryObj } from "@storybook/nextjs";

import { DiagnosticsButton } from "~/components/studio/logs/DiagnosticsButton";

/**
 * 「打包诊断现场」按钮 —— 第三层注入（store）的现场之一。
 *
 * 它自己从 `useLogPanel` 取 `saveDiagnostics` action（这是 props 给不了的东西），
 * 所以 story 走 `parameters.storeScene` 先把时间线写进 store。它的**成败回执是
 * 按钮本地自持**的（`useFlashLatch`），也就是这一组要摆的两档：
 *
 *  · **成功**：按钮旁边标出 `log/exports/<名>.zip` —— 那句路径就是「文件在哪」
 *    的可引用事实（用户点一下、把路径发过来，比截图靠谱）；
 *  · **失败**：改口「打包失败」，**不谎报成功**（否则用户会去一个不存在的路径找）。
 *
 * 与 `SaveExportButton` 的分工是刻意的、也是这份 story 要读者看见的：那一个存的
 * 是**面板当前筛选到的行**（看得见的东西），这一个带走的是**整份诊断现场**
 *（`run.json` 的环境信息、上次崩溃的残留、comfy-cli 原始回执）—— 那些在面板上
 * 根本看不到。两者不可互相替代，所以各自的悬停提示必须说清自己带走的是什么。
 *
 * 画布上默认看到的是**初始态**（没点过）。真去点它需要服务端在跑（跨源那道门槛
 * 与 `data-sources.tsx` 的 tRPC 一节同源），所以这里以「初始态 + 悬停提示」为主
 * —— 那正是它在真机上大多数时候的样子。
 */
const meta = {
  component: DiagnosticsButton,
  parameters: { storeScene: "mixed" },
  title: "Studio/Logs/DiagnosticsButton",
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
