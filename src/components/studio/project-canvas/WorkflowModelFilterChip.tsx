"use client";

/** 从 WorkflowNode.tsx 抽出的「模型标签筛选」chip（下拉 4）。行为与外观不变。
 *  浮层壳与选项行走 `ui/option-list-popover`（规范 16 §16.2.4.14）。
 */
import { OptionListPopover } from "~/components/ui/option-list-popover";

interface WorkflowModelFilterChipProps {
  value: string;
  tags: { id: string; name: string; count: number }[];
  onChange: (v: string) => void;
}

export function WorkflowModelFilterChip({
  value,
  tags,
  onChange,
}: WorkflowModelFilterChipProps) {
  const label = value === "all" ? "全部模型" : value;

  return (
    <OptionListPopover
      value={value}
      onSelect={onChange}
      triggerTitle={value === "all" ? "按模型筛选" : `已筛选模型：${value}`}
      align="start"
      contentClassName="w-72"
      triggerClassName="border-accent/35 bg-node-accent h-6 shrink-0 rounded-lg border px-2.5 text-[12px]"
      trigger={
        <>
          <span
            className={`size-1.5 shrink-0 rounded-full ${
              value === "all" ? "bg-accent" : "bg-accent-soft"
            }`}
          />
          <span
            className="text-accent-soft max-w-20 truncate font-semibold"
            style={{ fontFamily: "var(--font-sans)", fontSize: 10 }}
          >
            {label}
          </span>
        </>
      }
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
          suffix: (
            <span className="text-ink-muted text-[9px] tabular-nums">
              {tag.count}
            </span>
          ),
        })),
      ]}
    />
  );
}
