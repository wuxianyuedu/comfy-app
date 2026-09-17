"use client";

import dynamic from "next/dynamic";

import { ModelTagManager } from "../ModelTagManager";
import { DeleteWorkflowModal } from "../DeleteWorkflowModal";
import { WorkflowImportPanel } from "../WorkflowImportPanel";
import { WorkflowLibraryHeader } from "./WorkflowLibraryHeader";
import { WorkflowLibraryList } from "./WorkflowLibraryList";
import { WorkflowLibraryDetail } from "./WorkflowLibraryDetail";
import { useWorkflowLibrary } from "./hooks/use-workflow-library";
import { FullScreenLayer } from "../fullscreen/FullScreenLayer";

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
      <FullScreenLayer
        zClass="z-50"
        className="bg-bg flex items-center justify-center"
      >
        <div className="text-center">
          <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-2 border-violet-500/30 border-t-violet-500" />
          <p className="text-ink-faint text-sm">加载工作流编辑器…</p>
        </div>
      </FullScreenLayer>
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
        <div className="flex items-start gap-2 border-b border-red-500/25 bg-red-500/8 px-5 py-2.5 text-[12px] text-red-700 dark:text-red-300">
          <span className="font-semibold">⚠</span>
          <span className="min-w-0 flex-1">{c.actionError}</span>
          <button
            type="button"
            onClick={c.refresh}
            className="shrink-0 rounded-md border border-red-400/30 px-2 py-0.5 text-[11px] text-red-700 transition-colors hover:bg-red-500/15 dark:text-red-300"
          >
            重试
          </button>
        </div>
      )}

      {c.loadError && !c.actionError && (
        <div className="flex items-start gap-2 border-b border-amber-500/25 bg-amber-500/8 px-5 py-2.5 text-[12px] text-amber-700 dark:text-amber-300">
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
          loading={c.loading}
          stalled={c.loadStalled}
          onRefresh={c.refresh}
          localRootsHint={c.localRootsHint}
          /* 拖入 JSON 导入：整片列表侧栏就是投放区（与导入面板同一漏斗）。 */
          dragActive={c.importState.listDragActive}
          onDragOver={c.importState.onListDragOver}
          onDragEnter={c.importState.onListDragEnter}
          onDragLeave={c.importState.onListDragLeave}
          onDrop={c.importState.onListDrop}
          fileErr={c.importState.dropErr}
          pendingLoading={c.pendingLoading}
        />
        {/* `min-w-0` 必须有：详情面板是弹性项，默认 `min-width: auto` 会让它**不
            肯窄于内容的最小宽度**（面板里的画布预览、卡片列都不小），于是整行宽度
            超过窗口、右半部分连同头部按钮一起被根容器的 `overflow-hidden` 裁掉
            ——用户在小屏上「看不到最右侧的内容」就是这个成因。列表是固定宽侧栏，
            因此让它 `shrink-0`，宽度压力全部由详情面板承担（面板内部自带滚动 /
            画布平移缩放）。 */}
        <div className="min-w-0 flex-1 overflow-hidden">
          <WorkflowLibraryDetail
            workflow={c.selectedRow}
            allModelTags={c.modelTags}
            onPatchModes={c.patchModes}
            onPatchModelTags={c.patchModelTags}
            onPatchWorkflowIO={c.patchWorkflowIO}
            onPatchParamMap={c.patchParamMap}
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
        onClose={c.handleEditorClose}
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
