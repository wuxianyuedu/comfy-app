import type { Meta, StoryObj } from "@storybook/nextjs";
import { RefreshCcw } from "lucide-react";

import { Button } from "~/components/ui/button";
import { PageHeader } from "~/components/ui/page-header";

/**
 * `ui/page-header` 是屏级页头的**唯一实现**（规范 16 §16.2.4.73）。
 *
 * 收口之前，「`h1` + 一行副说明 + 右侧动作组」这组结构在 11 个屏上各拼一遍：
 * 字阶档那一件有 P83 兜着（各屏都写了 `u-title-page`），但**副说明那一句**没有
 * 判据 —— 于是它一点点长成了「把标题又写长一遍」的地方。ISSUE #1423 的原始反馈
 * 就是它的极端形态：侧栏「队列」→ 页签「队列」→ 页头「队列与运行」，
 * 同一件事一屏两个名字、标题区吃掉大片纵向空间。
 *
 * 所以本 story 要看的是**几档真实存在的取舍**：
 * · `Default` —— 副说明写「答案在别处拿不到的那句话」（时间口径 / 数据来源）；
 * · `WithoutDescription` —— 想不出这种话就**不传**，标题区立刻矮下来；
 * · `TabNamed`（ISSUE #1693）—— 页签已经在说屏名时**整行都不出现**：屏名退到
 *   `sr-only`（读屏仍能跳转），那句解释收进悬浮「说明」按钮；
 * · `WithActions` / `LongTitle` —— 右侧动作组不收缩、长标题先截断（规范 03
 *   §3.8.1 的兜底顺序）。
 *
 * 没有变体轴（`as` 是标签名不是外观变体），所以 Args 面板只摆文本与节点。
 */
const meta = {
  args: {
    description: "在项目根执行命令；命令与其子进程在切走视图或点「停止」时一并回收。",
    title: "控制台",
  },
  component: PageHeader,
  title: "UI/PageHeader",
} satisfies Meta<typeof PageHeader>;

export default meta;

type Story = StoryObj<typeof meta>;

/** 真实形态之一：一句话说清时间口径（历史屏就是这么写的）。 */
export const Default: Story = {
  args: {
    description: "所有生成任务与执行日志，按时间倒序排列。",
    title: "历史记录",
  },
};

/** 想不出「答案在别处拿不到的那句话」时不传副说明 —— 标题区不占第二行。 */
export const WithoutDescription: Story = {
  args: {
    description: undefined,
    title: "资源库",
  },
};

/** 页签已经在说屏名（主页那几个页签都是）—— 可见标题与副说明都不占位。
 *
 *  留在 DOM 里的 `sr-only` `h1` 是本档的**前提**，不是可选装饰：屏名只在页签上
 *  时，读屏用户仍然需要一个可跳转的标题（规范 06）。 */
export const TabNamed: Story = {
  args: {
    description: undefined,
    help: "每 2 秒读一次本机后端；位次按提交先后排，第 1 位就是下一个开跑的。",
    srTitle: "队列",
    title: undefined,
  },
};

/** 右侧动作组：整组 `shrink-0`，窄窗下换行而不是被压成两行小字。 */
export const WithActions: Story = {
  args: {
    actions: (
      <>
        <span className="text-ink-faint text-xs tabular-nums">待执行 3</span>
        <Button size="xs" variant="outline">
          <RefreshCcw aria-hidden className="size-3" data-icon="inline-start" />
          刷新
        </Button>
      </>
    ),
    description: "每 2 秒读一次本机后端；位次按提交先后排，第 1 位就是下一个开跑的。",
    title: "队列与运行",
  },
  /** 动作组的下限宽度：低于它就走「整排换行」，标题不再被继续压缩。 */
  parameters: { viewport: { defaultViewport: "mobile1" } },
};

/** 长标题（项目名当标题）：先截断标题，再考虑换行。 */
export const LongTitle: Story = {
  args: {
    actions: (
      <Button size="sm" variant="outline">
        刷新
      </Button>
    ),
    description: undefined,
    title: "一个名字特别长的项目：雾中来信（重制版）",
    titleSuffix: "· 产出",
  },
};

/**
 * `extra`：标题行下面再挂一层结构（进度条 / 徽标那族）。
 * 它落在副说明与动作区之间 —— 只是多一行补充信息就不要用它，归 `description`。
 */
export const WithExtra: Story = {
  args: {
    description: "六段流程的完成度按已落地的产物算，不按点过几下算。",
    extra: (
      <div className="bg-surface-2 mt-2 h-1.5 w-64 overflow-hidden rounded-full">
        <div className="bg-primary h-full w-2/5 rounded-full" />
      </div>
    ),
    title: "工坊管线",
  },
};
