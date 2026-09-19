"use client";

// 详情面板头部：标题 + 元信息 chip 行 + 类型/模型编辑器 + 操作按钮组。
// 纯展示；「导入画布」与右上角按钮同款式。

import { useState } from "react";
import {
  Download,
  Edit3,
  FileJson,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react";

import { Button } from "~/components/ui/button";
import { Spinner } from "~/components/ui/page-loading";
import { SourceTag } from "~/components/ui/source-tag";
import { TaskTypeChip } from "~/components/ui/task-type-chip";
import { modeLabel } from "../workflow-library-config";
import { type WorkflowRow } from "../workflow-library-config";
import { WorkflowRunLogButton } from "../WorkflowRunLogButton";
import { WorkflowRunLogModal } from "../WorkflowRunLogModal";
import { ActionButton } from "./DetailControls";
import { ModelTagPicker } from "./MetaEditor";
import type { MetaEditorController } from "../hooks/use-workflow-library-detail";
import { zClass } from "~/lib/shell/overlay-z";

interface DetailHeaderProps {
  workflow: WorkflowRow;
  usable: boolean;
  canResync: boolean;
  missing: boolean;
  isTechnical: boolean;
  busyDownload: boolean;
  busyResync: boolean;
  /** 类型 / 模型编辑器（含多模式与模型标签），渲染在头部内。 */
  meta: MetaEditorController;
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
  meta,
  onEdit,
  onResync,
  onDownload,
  onDelete,
  onOpenSource,
  onUse,
}: DetailHeaderProps) {
  /* 多模式时点击顶部模式徽标展开全部模式的小提示（问题：模式重复罗列，
   * 收敛到顶部一处）。 */
  const [showAllModes, setShowAllModes] = useState(false);
  /* 执行日志：详情头部固定的一扇门 —— 「画布节点」与「工坊封装」两个页签共用
   *  同一份运行登记表（`workflow-run-store`）与同一个全屏弹窗（ISSUE #611）。
   *  入口放在操作排里，位置固定；没跑过也显示（点开是空态文案），用户不必再
   *  进页签找日志。`logTaskId` 为 null 时弹窗自己落到该工作流最近一次运行。 */
  const [logOpen, setLogOpen] = useState(false);
  const [logTaskId, setLogTaskId] = useState<string | null>(null);
  const modes = workflow.modes ?? [];

  return (
    <div className="border-border-subtle border-b px-5 py-4">
      {/* 标题区与操作按钮组同排。窗口窄 / 详情面板被挤窄时**整组按钮换到第二行**，
          而不是被挤出去裁掉：面板根容器是 `overflow-hidden`，按钮组一旦溢出右侧就
          直接消失（此前 `shrink-0` + 无 `flex-wrap` 的形态下，小屏看不到「删除」这
          类最右侧的按钮）。与编辑器顶栏同一套退化顺序（见
          workflow-editor/workflow-editor-topbar-config.ts）：让位的是标题区
          （截断），换行的是按钮组，按钮本身绝不压扁。 */}
      <div
        className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2"
        data-testid="detail-header-row"
      >
        <div className="min-w-[180px] flex-1" data-testid="detail-title-block">
          <h2
            className={[
              "truncate text-lg font-semibold",
              isTechnical ? "text-ink-strong font-mono" : "text-ink",
            ].join(" ")}
            title={workflow.name}
          >
            {workflow.name}
          </h2>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="relative">
              <Button
                variant="ghost"
                onClick={() => {
                  if (modes.length > 1) setShowAllModes((value) => !value);
                }}
                disabled={modes.length <= 1}
                title={
                  modes.length > 1
                    ? "该工作流支持多种模式，点击查看全部"
                    : modes[0]
                      ? `${modeLabel(modes[0])}（${modes[0]}）`
                      : undefined
                }
                className={`h-auto gap-0 p-0 disabled:opacity-100 ${
                  modes.length > 1 ? "cursor-pointer" : "cursor-default"
                }`}
              >
                <TaskTypeChip taskType={workflow.taskType} />
              </Button>
              {showAllModes && modes.length > 1 && (
                <div
                  className={`border-border bg-panel absolute top-full left-0 ${zClass("popup")} mt-1 flex min-w-[140px] flex-col gap-0.5 rounded-lg border p-1.5 shadow-xl`}
                >
                  {modes.map((code) => (
                    <span
                      key={code}
                      className={`rounded px-2 py-0.5 text-[11px] ${
                        code === workflow.defaultMode
                          ? "bg-violet-500/15 text-violet-700 dark:text-violet-300"
                          : "text-ink-faint"
                      }`}
                    >
                      {modeLabel(code)}
                      {code === workflow.defaultMode ? "（默认）" : ""}
                    </span>
                  ))}
                </div>
              )}
            </span>
            <SourceTag source={workflow.source} />
            {(workflow.modelTags ?? []).map((tag) => (
              <span
                key={tag}
                className="border-border bg-subtle text-ink-faint rounded-full border px-2 py-0.5 text-[10px]"
              >
                {tag}
              </span>
            ))}
            {/* 两列都为空时提前标注，而不是等用户点了「生成」才报错。
                正常导入不会落到这里：raw 与 api 地位同等，任一列有内容即可执行。 */}
            {!usable && (
              <span className="rounded bg-red-500/12 px-1.5 py-0.5 text-[10px] text-red-700 dark:text-red-300">
                无可执行内容
              </span>
            )}
            {canResync && (
              <span
                className={[
                  "rounded px-1.5 py-0.5 text-[10px]",
                  missing
                    ? "bg-red-500/12 text-red-700 dark:text-red-300"
                    : "bg-amber-500/12 text-amber-700 dark:text-amber-300",
                ].join(" ")}
              >
                {missing ? "磁盘文件已丢失" : "磁盘文件有更新"}
              </span>
            )}
          </div>
        </div>

        {/* `ml-auto`：换行后独占第二行时仍靠右（父级 `justify-between` 在只剩一个
            子项的行上会把它推到左侧）。 */}
        <div
          className="ml-auto flex flex-wrap items-center justify-end gap-2"
          data-testid="detail-actions"
        >
          <ActionButton
            onClick={onUse}
            icon={<Plus className="h-3.5 w-3.5" />}
            label="导入画布"
            title={
              usable
                ? "把该工作流导入项目画布"
                : "当前工作流没有工作流(RAW)原件，无法生成"
            }
            disabled={!usable}
          />
          {/* 模型标签绑定：与导入画布同款描边样式，点开多选管理 */}
          <ModelTagPicker meta={meta} />
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
                busyResync ? (
                  <Spinner className="size-3.5" />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5" />
                )
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
          {/* 执行日志入口：详情头部的一扇固定门（两个页签共用同一份运行登记表、
              同一个全屏弹窗）。没跑过也显示 —— 点开是空态文案，入口位置不随
              「有没有跑过」变化，用户不必到页签里找日志。 */}
          <WorkflowRunLogButton
            workflowId={workflow.id}
            taskId={logTaskId}
            alwaysVisible
            onOpen={() => setLogOpen(true)}
          />
        </div>
      </div>

      {/* 全屏执行日志弹窗：与两个页签同一个组件、同一份运行登记表。 */}
      <WorkflowRunLogModal
        open={logOpen}
        workflowId={workflow.id}
        viewTaskId={logTaskId}
        onViewTaskIdChange={setLogTaskId}
        onClose={() => setLogOpen(false)}
      />
    </div>
  );
}
