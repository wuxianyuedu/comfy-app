"use client";

// 详情面板头部：标题 + 元信息 chip 行 + 操作按钮组 + 主 CTA。纯展示。

import {
  AlertTriangle,
  Download,
  Edit3,
  FileJson,
  Play,
  RefreshCw,
  Trash2,
} from "lucide-react";

import { SourceTag } from "~/components/studio/ui/SourceTag";
import { TaskTypeChip } from "~/components/studio/ui/TaskTypeChip";
import { type WorkflowRow } from "../workflow-library-config";
import { ActionButton } from "./DetailControls";

interface DetailHeaderProps {
  workflow: WorkflowRow;
  usable: boolean;
  canResync: boolean;
  missing: boolean;
  isTechnical: boolean;
  busyDownload: boolean;
  busyResync: boolean;
  onEdit: () => void;
  onResync: () => void;
  onDownload: () => void;
  onDelete: () => void;
  onOpenSource: () => void;
  onUse: () => void;
}

export function DetailHeader({
  workflow,
  usable,
  canResync,
  missing,
  isTechnical,
  busyDownload,
  busyResync,
  onEdit,
  onResync,
  onDownload,
  onDelete,
  onOpenSource,
  onUse,
}: DetailHeaderProps) {
  return (
    <div className="border-b border-white/6 px-5 py-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2
            className={[
              "truncate text-lg font-semibold",
              isTechnical ? "font-mono text-white/80" : "text-white",
            ].join(" ")}
            title={workflow.name}
          >
            {workflow.name}
          </h2>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <TaskTypeChip taskType={workflow.taskType} />
            <SourceTag source={workflow.source} />
            {(workflow.modelTags ?? []).map((tag) => (
              <span
                key={tag}
                className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[10px] text-white/60"
              >
                {tag}
              </span>
            ))}
            {/* 缺少可执行图时提前标注，而不是等用户点了「生成」才报错。 */}
            {!usable && (
              <span className="rounded bg-red-500/12 px-1.5 py-0.5 text-[10px] text-red-300">
                不可执行
              </span>
            )}
            {canResync && (
              <span
                className={[
                  "rounded px-1.5 py-0.5 text-[10px]",
                  missing
                    ? "bg-red-500/12 text-red-300"
                    : "bg-amber-500/12 text-amber-300",
                ].join(" ")}
              >
                {missing ? "磁盘文件已丢失" : "磁盘文件有更新"}
              </span>
            )}
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
          <ActionButton
            onClick={onEdit}
            icon={<Edit3 className="h-3.5 w-3.5" />}
            label="编辑"
            title="在工作流编辑器中打开"
          />
          {canResync && (
            <ActionButton
              onClick={onResync}
              icon={
                <RefreshCw className={`h-3.5 w-3.5 ${busyResync ? "animate-spin" : ""}`} />
              }
              label={busyResync ? "同步中" : "同步"}
              disabled={busyResync}
            />
          )}
          <ActionButton
            onClick={onOpenSource}
            icon={<FileJson className="h-3.5 w-3.5" />}
            label="源文件"
          />
          <ActionButton
            onClick={onDownload}
            icon={<Download className="h-3.5 w-3.5" />}
            label={busyDownload ? "准备中" : "下载"}
            disabled={busyDownload}
          />
          <ActionButton
            onClick={onDelete}
            icon={<Trash2 className="h-3.5 w-3.5" />}
            label="删除"
            variant="danger"
          />
        </div>
      </div>

      {/* 主 CTA */}
      <div className="mt-4 flex items-center gap-3">
        <button
          type="button"
          disabled={!usable}
          onClick={onUse}
          className={[
            "btn-gradient inline-flex items-center gap-2 rounded-lg px-5 py-2 text-sm font-medium text-white shadow-lg shadow-violet-500/20 transition-all",
            !usable ? "opacity-40" : "hover:shadow-violet-500/30",
          ].join(" ")}
        >
          <Play className="h-4 w-4 fill-current" />
          用此工作流生成
        </button>
        {!usable && (
          <span className="flex items-center gap-1 text-[11px] text-red-300/80">
            <AlertTriangle className="h-3.5 w-3.5" />
            当前工作流缺少可执行格式，无法生成
          </span>
        )}
      </div>
    </div>
  );
}
