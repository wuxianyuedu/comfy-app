"use client";

/** 从 WorkflowNode.tsx 抽出的「工作流选择」chip（下拉 2，按来源/模型过滤）。
 *  行为与外观保持不变。浮层壳与选项行走 `ui/option-list-popover`
 *  （规范 16 §16.2.4.14）—— 此前这份壳在本目录的四个 chip 里各写了一遍。
 */
import { PageLoading } from "~/components/ui/page-loading";
import { OptionListPopover } from "~/components/ui/option-list-popover";

export type WorkflowPickOption = {
  id: string;
  name: string;
  taskType?: string;
  sourcePath?: string | null;
  modelTags?: string[];
};

interface WorkflowPickChipProps {
  value: string;
  options: WorkflowPickOption[];
  onSelect: (id: string) => void;
  emptyHint?: string;
  /** 列表仍在加载时显示"加载中"，避免把加载态误渲染成空态。 */
  loading?: boolean;
}

export function WorkflowPickChip({
  value,
  options,
  onSelect,
  emptyHint,
  loading = false,
}: WorkflowPickChipProps) {
  const sel = options.find((option) => option.id === value);

  return (
    <OptionListPopover
      value={value}
      onSelect={onSelect}
      triggerTitle="选择工作流"
      align="start"
      contentClassName="w-70 py-1"
      triggerClassName="border-primary/35 bg-node-accent h-6 min-w-0 flex-1 rounded-lg border px-2.5 text-[12px]"
      trigger={
        <span
          className="text-ink-bright min-w-0 flex-1 truncate text-left font-semibold"
          style={{ fontFamily: "var(--font-sans)", fontSize: 11 }}
        >
          {loading && !sel ? (
            <span className="text-ink-muted">加载中…</span>
          ) : sel ? (
            sel.name
          ) : (
            <span className="text-ink-muted">选择工作流…</span>
          )}
        </span>
      }
      emptyHint={
        loading ? (
          <div className="flex items-center gap-2 px-0 py-1">
            <PageLoading label="加载中…" className="flex-row gap-2" />
          </div>
        ) : (
          (emptyHint ?? "暂无符合筛选的工作流")
        )
      }
      items={options.map((option) => ({
        value: option.id,
        label: option.name,
        title: option.name,
        prefix: (
          <span
            className={`size-1.5 shrink-0 rounded-full ${
              option.sourcePath ? "bg-status-online" : "bg-primary-strong"
            }`}
          />
        ),
        suffix: option.taskType ? (
          <span className="bg-subtle text-ink-muted shrink-0 rounded px-1.5 py-0.5 text-[9.5px]">
            {option.taskType}
          </span>
        ) : undefined,
      }))}
    />
  );
}
