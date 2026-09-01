"use client";

import { useMemo, useState } from "react";
import {
  Edit3,
  Download,
  Trash2,
  FileJson,
  RefreshCw,
  AlertTriangle,
  Play,
  ExternalLink,
  Maximize2,
} from "lucide-react";
import { api } from "~/trpc/react";
import { WorkflowCanvasNodePreview } from "./WorkflowCanvasNodePreview";
import { SourceModal } from "../SourceModal";
import { DynamicWorkflowForm } from "../shared/DynamicWorkflowForm";
import type { WorkflowIOMap } from "../shared/workflow-io";
import { JsonViewer } from "../ui/JsonViewer";
import { TaskTypeChip } from "../ui/TaskTypeChip";
import { SourceTag } from "../ui/SourceTag";
import type { WorkflowRow } from "./WorkflowLibraryHelpers";
import {
  deriveFormatFlags,
  deriveSyncFlags,
  ago,
  isTechnicalName,
} from "./WorkflowLibraryHelpers";

interface WorkflowLibraryDetailProps {
  workflow: WorkflowRow | null;
  onUse: (id: string, meta?: { name: string; taskType: string }) => void;
  onEdit: (id: string) => void;
  onDelete: (id: string, name: string) => void;
  onDownload: (id: string, name: string) => void;
  onResync: (id: string, name: string) => void;
  bundleBusy: string | null;
  resyncBusy: string | null;
}

/**
 * 右侧工作流详情面板：画布节点拓扑、参数表单、源文件、操作入口。
 */
export function WorkflowLibraryDetail({
  workflow,
  onUse,
  onEdit,
  onDelete,
  onDownload,
  onResync,
  bundleBusy,
  resyncBusy,
}: WorkflowLibraryDetailProps) {
  const [sourceOpen, setSourceOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<"canvas" | "params" | "source">(
    "canvas",
  );

  const detailQuery = api.workflow.detail.useQuery(
    { id: workflow?.id ?? "" },
    { enabled: !!workflow },
  );

  const detail = detailQuery.data;
  const template = detail?.template;
  const workflowIO = useMemo(() => {
    if (!template?.workflowIO || Array.isArray(template.workflowIO))
      return null;
    if (typeof template.workflowIO !== "object") return null;
    return template.workflowIO as unknown as WorkflowIOMap;
  }, [template]);

  if (!workflow) {
    return (
      <div className="flex h-full flex-col items-center justify-center text-white/30">
        <div className="mb-3 flex h-16 w-16 items-center justify-center rounded-2xl border border-white/8 bg-white/[0.03]">
          <ExternalLink className="h-7 w-7 opacity-40" />
        </div>
        <p className="text-sm">在左侧选择一个工作流查看详情</p>
      </div>
    );
  }

  const { usable } = deriveFormatFlags(workflow);
  const { missing, canResync } = deriveSyncFlags(workflow);
  const isTech = isTechnicalName(workflow.name);
  const busyDownload = bundleBusy === workflow.id;
  const busyResync = resyncBusy === workflow.id;

  const sourceData = template
    ? {
        name: workflow.name,
        source: template.rawJson ?? template.graph ?? null,
        isApiFallback: template.rawJson == null,
      }
    : null;

  return (
    <div className="flex h-full flex-col overflow-hidden bg-[#0D0D12]">
      {/* Header */}
      <div className="border-b border-white/6 px-5 py-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2
              className={[
                "truncate text-lg font-semibold",
                isTech ? "font-mono text-white/80" : "text-white",
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
            <p className="mt-2 text-[11px] text-white/35">
              {ago(workflow.createdAt)}
            </p>
          </div>

          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
            <ActionButton
              onClick={() => onEdit(workflow.id)}
              icon={<Edit3 className="h-3.5 w-3.5" />}
              label="编辑"
              title="在工作流编辑器中打开"
            />
            {canResync && (
              <ActionButton
                onClick={() => onResync(workflow.id, workflow.name)}
                icon={
                  <RefreshCw
                    className={`h-3.5 w-3.5 ${busyResync ? "animate-spin" : ""}`}
                  />
                }
                label={busyResync ? "同步中" : "同步"}
                disabled={busyResync}
              />
            )}
            <ActionButton
              onClick={() => setSourceOpen(true)}
              icon={<FileJson className="h-3.5 w-3.5" />}
              label="源文件"
            />
            <ActionButton
              onClick={() => onDownload(workflow.id, workflow.name)}
              icon={<Download className="h-3.5 w-3.5" />}
              label={busyDownload ? "准备中" : "下载"}
              disabled={busyDownload}
            />
            <ActionButton
              onClick={() => onDelete(workflow.id, workflow.name)}
              icon={<Trash2 className="h-3.5 w-3.5" />}
              label="删除"
              variant="danger"
            />
          </div>
        </div>

        {/* Primary CTA */}
        <div className="mt-4 flex items-center gap-3">
          <button
            type="button"
            disabled={!usable}
            onClick={() =>
              onUse(workflow.id, {
                name: workflow.name,
                taskType: workflow.taskType,
              })
            }
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

      {/* Tabs */}
      <div className="flex border-b border-white/6 px-5">
        <TabButton
          active={activeTab === "canvas"}
          onClick={() => setActiveTab("canvas")}
        >
          画布节点
        </TabButton>
        <TabButton
          active={activeTab === "params"}
          onClick={() => setActiveTab("params")}
        >
          参数配置
        </TabButton>
        <TabButton
          active={activeTab === "source"}
          onClick={() => setActiveTab("source")}
        >
          源文件
        </TabButton>
      </div>

      {/* Body */}
      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        {detailQuery.isLoading && (
          <div className="flex h-40 items-center justify-center text-xs text-white/40">
            加载详情中…
          </div>
        )}

        {activeTab === "canvas" && (
          <div className="flex h-full min-h-[420px] flex-col rounded-2xl border border-white/8 bg-[#0B0B10] p-1">
            <div className="flex items-center justify-between px-3 py-2">
              <span className="text-xs font-medium text-white/60">
                画布样式预览（与项目画布节点一致，可直接运行调试）
              </span>
              <button
                type="button"
                onClick={() => onEdit(workflow.id)}
                className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-violet-300 transition-colors hover:bg-violet-500/10"
              >
                <Maximize2 className="h-3 w-3" />
                在编辑器中打开
              </button>
            </div>
            <div className="flex min-h-0 flex-1 justify-center overflow-y-auto py-3">
              <WorkflowCanvasNodePreview
                workflowId={workflow.id}
                workflowName={workflow.name}
                taskType={workflow.taskType}
                workflowIO={workflowIO}
                usable={usable}
              />
            </div>
          </div>
        )}

        {activeTab === "params" && (
          <div
            key={workflow.id}
            className="mx-auto max-w-2xl rounded-2xl border border-white/8 bg-[#0B0B10] p-4"
          >
            <h3 className="mb-3 text-sm font-medium text-white/80">
              可配置参数
            </h3>
            <WorkflowParamForm io={workflowIO} workflowId={workflow.id} />
          </div>
        )}

        {activeTab === "source" && (
          <div className="rounded-2xl border border-white/8 bg-[#0B0B10] p-1">
            <div className="flex items-center justify-between px-3 py-2">
              <span className="text-xs font-medium text-white/60">
                {sourceData?.isApiFallback
                  ? "可执行图（无原始文件）"
                  : "原始导入 JSON"}
              </span>
            </div>
            <div className="max-h-[70vh] overflow-auto rounded-xl bg-black/30">
              {sourceData?.source != null ? (
                <JsonViewer
                  data={sourceData.source}
                  title={sourceData.isApiFallback ? "API 格式" : "源文件"}
                  initialCollapsedDepth={2}
                />
              ) : (
                <p className="px-4 py-10 text-center text-xs text-white/30">
                  暂无源文件数据
                </p>
              )}
            </div>
          </div>
        )}
      </div>

      {sourceOpen && (
        <SourceModal
          data={sourceData}
          loading={detailQuery.isLoading}
          error={detailQuery.error?.message}
          onClose={() => setSourceOpen(false)}
        />
      )}
    </div>
  );
}

function WorkflowParamForm({
  io,
  workflowId,
}: {
  io: WorkflowIOMap | null;
  workflowId: string;
}) {
  const [values, setValues] = useState<Record<string, unknown>>({});
  return (
    <DynamicWorkflowForm
      io={io}
      values={values}
      onChange={setValues}
      workflowId={workflowId}
    />
  );
}

function ActionButton({
  onClick,
  icon,
  label,
  title,
  disabled,
  variant = "default",
}: {
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  title?: string;
  disabled?: boolean;
  variant?: "default" | "danger";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title ?? label}
      className={[
        "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-medium transition-colors",
        variant === "danger"
          ? "border-red-500/20 bg-red-500/8 text-red-300 hover:bg-red-500/15 disabled:opacity-40"
          : "border-white/10 bg-white/[0.04] text-white/75 hover:bg-white/[0.08] hover:text-white disabled:opacity-40",
      ].join(" ")}
    >
      {icon}
      {label}
    </button>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "relative px-3 py-2.5 text-[12px] font-medium transition-colors",
        active ? "text-white" : "text-white/45 hover:text-white/75",
      ].join(" ")}
    >
      {children}
      {active && (
        <span className="absolute inset-x-3 bottom-0 h-0.5 rounded-full bg-linear-to-r from-violet-500 to-fuchsia-500" />
      )}
    </button>
  );
}
