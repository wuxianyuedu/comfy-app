"use client";

/** 从 WorkflowNode.tsx 抽出的「来源筛选」chip（本机 / 在线 / 全部）。
 *  行为与外观保持不变。浮层壳与选项行走 `ui/option-list-popover`
 *  （规范 16 §16.2.4.14）。 */
/* 类型来自叶子模块而不是宿主：经宿主会形成
 * `WorkflowNode → chip → WorkflowNode` 的循环（规范 12.7）。 */
import { OptionListPopover } from "~/components/ui/option-list-popover";
import type { WorkflowSourceFilter } from "./workflow-node-types";

interface WorkflowSourceFilterChipProps {
  value: WorkflowSourceFilter;
  onChange: (v: WorkflowSourceFilter) => void;
}

const OPTIONS: {
  v: WorkflowSourceFilter;
  label: string;
  local: boolean;
}[] = [
  { v: "all", label: "全部", local: false },
  { v: "local", label: "本机", local: true },
  { v: "online", label: "在线", local: false },
];

export function WorkflowSourceFilterChip({
  value,
  onChange,
}: WorkflowSourceFilterChipProps) {
  const isLocal = value === "local";
  const label = value === "all" ? "全部" : isLocal ? "本机" : "在线";

  return (
    <OptionListPopover
      value={value}
      onSelect={(next) => onChange(next as WorkflowSourceFilter)}
      triggerTitle="工作流来源筛选"
      align="start"
      contentClassName="w-40"
      triggerClassName="border-primary/35 bg-overlay-accent-surface h-6 shrink-0 rounded-lg border px-2.5 text-xs"
      trigger={
        <>
          <span
            className={`size-1.5 shrink-0 rounded-full ${
              isLocal ? "bg-status-online" : "bg-primary-strong"
            }`}
          />
          <span
            className={`text-3xs font-semibold ${
              isLocal ? "text-status-online" : "text-primary-strong"
            }`}
            style={{ fontFamily: "var(--font-sans)" }}
          >
            {label}
          </span>
        </>
      }
      items={OPTIONS.map((option) => ({
        value: option.v,
        label: option.label,
        prefix: (
          <span
            className={`size-1.5 rounded-full ${
              option.local ? "bg-status-online" : "bg-primary-strong"
            }`}
          />
        ),
      }))}
    />
  );
}
