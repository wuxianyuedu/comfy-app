"use client";

/** 从 WorkflowNode.tsx 抽出的「模型标签筛选」chip（下拉 4）。行为与外观不变。
 *  浮层壳与选项行走 `ui/option-list-popover`（规范 16 §16.2.4.14）。
 */
import { OptionListPopover } from "~/components/ui/option-list-popover";
import { TruncatedText } from "~/components/ui/truncated-text";

type WorkflowModelFilterChipProps = {
  onChange: (v: string) => void;
  tags: Array<{ count: number; id: string; name: string }>;
  value: string;
};

export function WorkflowModelFilterChip({ value, tags, onChange }: WorkflowModelFilterChipProps) {
  const label = value === "all" ? "全部模型" : value;

  return (
    <OptionListPopover
      align="start"
      contentClassName="w-72"
      emptyHint="标签库为空，去工作流库「管理模型」添加"
      items={[
        {
          value: "all",
          label: "全部模型",
          prefix: <span className="bg-accent size-1.5 rounded-full" />,
        },
        ...tags.map((tag) => ({
          value: tag.name,
          label: tag.name,
          title: tag.name,
          prefix: <span className="bg-accent-soft size-1.5 rounded-full" />,
          suffix: <span className="text-ink-muted text-4xs tabular-nums">{tag.count}</span>,
        })),
      ]}
      onSelect={onChange}
      trigger={
        <>
          <span
            className={`size-1.5 shrink-0 rounded-full ${
              value === "all" ? "bg-accent" : "bg-accent-soft"
            }`}
          />
          <TruncatedText className="text-accent-soft text-3xs max-w-20 truncate font-sans font-semibold">
            {label}
          </TruncatedText>
        </>
      }
      triggerClassName="border-accent/35 bg-node-accent h-6 shrink-0 rounded-lg border px-2.5 text-xs"
      triggerTitle={value === "all" ? "按模型筛选" : `已筛选模型：${value}`}
      value={value}
    />
  );
}
