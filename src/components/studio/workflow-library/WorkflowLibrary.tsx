"use client";

import dynamic from "next/dynamic";

import { ModelTagManager } from "../ModelTagManager";
import { DeleteWorkflowModal } from "../DeleteWorkflowModal";
import { WorkflowImportPanel } from "../WorkflowImportPanel";
import { WorkflowLibraryHeader } from "./WorkflowLibraryHeader";
import { WorkflowLibraryList } from "./WorkflowLibraryList";
import { WorkflowLibraryDetail } from "./WorkflowLibraryDetail";
import { useWorkflowLibrary } from "./hooks/use-workflow-library";

/**
 * Lazy-load the canvas editor. It is a 7k-line module; keeping it behind a
 * dynamic import means editing this file no longer forces webpack to recompile
 * the editor graph on every save.
 */
const WorkflowCanvasEditor = dynamic(
  () =>
    import("../canvas/WorkflowCanvasEditor").then(
      (mod) => mod.WorkflowCanvasEditor,
    ),
  {
    ssr: false,
    loading: () => (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-(--color-bg)">
        <div className="text-center">
          <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-2 border-violet-500/30 border-t-violet-500" />
          <p className="text-sm text-gray-400">加载工作流编辑器…</p>
        </div>
      </div>
    ),
  },
);

/**
 * WorkflowLibrary 重新设计为左右分栏布局。
 * 左侧为可搜索的工作流列表，右侧为选中项的详情面板，包含画布节点预览、
 * 参数表单、源文件与操作入口。原有的卡片网格、根目录折叠等交互移除。
 *
 * （规范 17 §17.2 第④层）：全部状态与业务规则搬进
 * `hooks/use-workflow-library.ts`，筛选/计数的推导搬进
 * `workflow-library-config.ts`。本文件只剩「取 controller → 传视图 → 挂弹层」。
 * 对外 props 与导出名不变，消费方（app/workspace/page.tsx）零改动。
 */
export function WorkflowLibrary({
  onUse,
}: {
  onUse?: (id: string, meta?: { name: string; taskType: string }) => void;
}) {
  const c = useWorkflowLibrary(onUse);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <WorkflowLibraryHeader
        onToggleImport={c.toggleImport}
        sourceFilter={c.sourceFilter}
        onSourceFilterChange={c.setSourceFilter}
        sourceCounts={c.sourceCounts}
        typeFilter={c.typeFilter}
        onTypeFilterChange={c.setTypeFilter}
        typeCounts={c.typeCounts}
        modelFilter={c.modelFilter}
        onModelFilterChange={c.setModelFilter}
        modelTags={c.modelTags}
        onManageModels={() => c.setShowModelManager(true)}
      />

      {c.showImport && (
        <WorkflowImportPanel
          state={c.importState}
          onClose={c.closeImport}
          onImport={c.importState.handleImport}
        />
      )}

      <DeleteWorkflowModal
        pendingDelete={c.pendingDelete}
        deleting={c.deleting}
        onConfirm={(id) => {
          void c.confirmDelete(id);
        }}
        onCancel={c.cancelDelete}
        onBackdropClick={() => {
          if (!c.deleting) c.cancelDelete();
        }}
      />

      {/* 动作失败提示：只有用户点「重试」才消失（§17.5.4），
       *  否则防抖期内的后台拉取一成功就会把它吞掉。 */}
      {c.actionError && (
        <div className="flex items-start gap-2 border-b border-red-500/25 bg-red-500/8 px-5 py-2.5 text-[12px] text-red-200">
          <span className="font-semibold">⚠</span>
          <span className="min-w-0 flex-1">{c.actionError}</span>
          <button
            type="button"
            onClick={c.refresh}
            className="shrink-0 rounded-md border border-red-400/30 px-2 py-0.5 text-[11px] text-red-200 transition-colors hover:bg-red-500/15"
          >
            重试
          </button>
        </div>
      )}

      {c.loadError && !c.actionError && (
        <div className="flex items-start gap-2 border-b border-amber-500/25 bg-amber-500/8 px-5 py-2.5 text-[12px] text-amber-200">
          <span className="font-semibold">⚠</span>
          <span className="min-w-0 flex-1">{c.loadError}</span>
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <WorkflowLibraryList
          workflows={c.workflows}
          pendingRows={c.pendingRows}
          selectedId={c.selectedId}
          search={c.search}
          onSearchChange={c.setSearch}
          onSelect={c.setSelectedId}
          onLoadPending={(pending) => {
            void c.handleLoadPending(pending);
          }}
        />
        <div className="flex-1">
          <WorkflowLibraryDetail
            workflow={c.selectedRow}
            allModelTags={c.modelTags}
            onPatchModes={c.patchModes}
            onPatchModelTags={c.patchModelTags}
            onUse={c.handleUse}
            onEdit={c.handleEdit}
            onDelete={c.handleDeleteClick}
            onDownload={(id, name) => {
              void c.handleDownload(id, name);
            }}
            onResync={(id, name) => {
              void c.handleResync(id, name);
            }}
            bundleBusy={c.bundleBusy}
            resyncBusy={c.resyncBusy}
          />
        </div>
      </div>

      <WorkflowCanvasEditor
        workflowId={c.editingId ?? ""}
        open={!!c.editingId}
        onClose={() => c.setEditingId(null)}
        onSave={c.load}
      />

      {c.showModelManager && (
        <ModelTagManager
          initialTags={c.modelTags}
          onChanged={c.loadModelTags}
          onClose={() => c.setShowModelManager(false)}
        />
      )}
    </div>
  );
}
