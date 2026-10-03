import type { Meta, StoryObj } from "@storybook/nextjs";
import { useState } from "react";

import {
  OptionListPopover,
  type OptionListItem,
} from "~/components/ui/option-list-popover";

/**
 * `OptionListPopover` 是「一个可滚动的浮层选项列表」的唯一实现
 *（规范 16 §16.2.4.14）—— 收口前画布节点上那四个 chip 各写了一份同形的浮层。
 *
 * 它看起来「有数据依赖」，实际上**没有**：`items` 是纯数据、`value` 是字符串、
 * `onSelect` 是回调。它此前没 story 的原因只是 `trigger` 是一个 ReactNode
 *（chip 的外观由调用处给）。按注入层的口径，ReactNode 参数走 story 的 `render`，
 * Args 里只留可调的那几个 —— 于是它其实是最容易写的一档。
 *
 * 要看的是「壳与行」这件事：触发器上的 `▾` 随 `aria-expanded` 旋转、选中行有勾、
 * 行内容可以带前后装饰（画布 chip 靠它挂颜色点与计数）。
 */
const ITEMS: OptionListItem[] = [
  { value: "workflow", label: "工作流名", title: "按工作流名过滤" },
  { value: "form", label: "形态", suffix: "3" },
  { value: "source", label: "来源", suffix: "12" },
  { value: "model", label: "模型标签" },
  { value: "empty", label: "空目录（没有命中时的行）", suffix: "0" },
];

/** chip 触发器：真机上由调用处给外观（配色 / 尺寸 / 圆角），这里照画布口径给。 */
function ChipTrigger({ label, count }: { label: string; count: number }) {
  return (
    <span className="border-border-strong bg-canvas-deep flex items-center gap-1.5 rounded-lg border px-2 py-0.5">
      <span className="text-ink-muted text-[10px]">{label}</span>
      <span className="text-ink-bright text-[11px] font-medium">{count}</span>
    </span>
  );
}

/**
 * 这一族 story 的 Args：全是**可序列化**的那几个（列表 / 选中值 / 文案）。
 * ReactNode 参数（`trigger`）与回调（`onSelect`）不在其中 —— 前者由 story 的
 * `render` 给，后者是空实现（见文件头「三条口径」第 3 条）。
 */
interface StoryArgs {
  value: string;
  items: OptionListItem[];
  triggerLabel: string;
  triggerCount: number;
  triggerTitle?: string;
  triggerClassName?: string;
  contentClassName?: string;
  listClassName?: string;
  emptyHint?: React.ReactNode;
  align?: "start" | "center" | "end";
  disabled?: boolean;
}

/** 适配件：把 Args 里那几项拼成一个真触发器，并补上选中回调。 */
function PopoverWithTrigger({
  triggerLabel,
  triggerCount,
  ...rest
}: StoryArgs) {
  return (
    <OptionListPopover
      {...rest}
      trigger={<ChipTrigger label={triggerLabel} count={triggerCount} />}
      onSelect={() => undefined}
    />
  );
}

/**
 * 受控开合的样本：**必须是组件** —— 它持 `useState`，而 `render` 的参数位置
 * 不是 React 组件（ESLint 的 `react-hooks/rules-of-hooks` 会拦，这条报错是对的）。
 */
function ControlledOpenSample() {
  const [openNote, setOpenNote] = useState("（还没开过）");
  return (
    <div className="flex flex-col items-start gap-3">
      <OptionListPopover
        value="form"
        items={ITEMS}
        onSelect={() => undefined}
        onOpenChange={(open) => setOpenNote(open ? "已开" : "已关")}
        trigger={<ChipTrigger label="形态" count={3} />}
        triggerClassName="border-border-strong bg-canvas-deep shrink-0 rounded-lg border px-2 py-0.5"
      />
      <span className="text-ink-muted font-mono text-[11px]">
        onOpenChange：{openNote}
      </span>
    </div>
  );
}

const meta = {
  title: "UI/OptionListPopover",
  component: PopoverWithTrigger,
  args: {
    value: "form",
    items: ITEMS,
    triggerLabel: "形态",
    triggerCount: 3,
    triggerTitle: "按形态过滤",
    triggerClassName:
      "border-border-strong bg-canvas-deep shrink-0 rounded-lg border transition-colors hover:border-primary/40",
  },
} satisfies Meta<StoryArgs>;

export default meta;

type Story = StoryObj<typeof meta>;

/** 默认：选中行有勾与高亮，行右侧的 `suffix` 是计数。 */
export const Default: Story = {};

/**
 * 前后装饰齐全的形态（画布 chip 的真实用法）：`prefix` 挂颜色点 / `suffix` 挂计数
 * 或类型章。左列的点不是装饰品 —— 它表达的「哪一类」就是用户扫这列时的判据。
 */
export const DecoratedRows: Story = {
  args: {
    items: [
      {
        value: "local",
        label: "本地模型",
        prefix: <span className="size-2 rounded-full bg-emerald-500" />,
        suffix: <span className="text-ink-faint text-[10px]">本机</span>,
      },
      {
        value: "remote",
        label: "在线模型",
        prefix: <span className="size-2 rounded-full bg-sky-500" />,
        suffix: <span className="text-ink-faint text-[10px]">API</span>,
      },
      {
        value: "missing",
        label: "未配置的条目",
        prefix: <span className="size-2 rounded-full bg-amber-500" />,
      },
    ],
    value: "local",
  },
};

/**
 * 空列表：`emptyHint` 是调用处给的（这条没有默认值 —— 空列表在不同面板里
 * 说法不同：「没有可选的」与「还没有建过」是两件事）。
 */
export const Empty: Story = {
  args: { items: [], value: "", emptyHint: "还没有可选的工作流" },
};

/** 禁用态：触发器不可点开（画布锁定 / 权限不足时的形态）。 */
export const Disabled: Story = {
  args: { disabled: true },
};

/** 受控开合：`onOpenChange` 给「画布一变换就关掉」这类外部联动用。 */
export const ControlledOpen: Story = {
  render: () => <ControlledOpenSample />,
};
