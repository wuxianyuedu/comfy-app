"use client";

import dynamic from "next/dynamic";

import { Button } from "~/components/ui/button";
import { PageLoading } from "~/components/ui/page-loading";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "~/components/ui/resizable";
import { ModelTagManager } from "../ModelTagManager";
import { WorkspaceFrame } from "../ViewContainer";
import { DeleteWorkflowModal } from "../DeleteWorkflowModal";
import { WorkflowImportPanel } from "../WorkflowImportPanel";
import { WorkflowLibraryHeader } from "./WorkflowLibraryHeader";
import { WorkflowLibraryList } from "./WorkflowLibraryList";
import { WorkflowLibraryDetail } from "./WorkflowLibraryDetail";
import { useWorkflowLibrary } from "./hooks/use-workflow-library";

/**
 * 懒加载画布编辑器。它是个 7k 行的模块；把它挡在
 * 动态 import 后面，意味着编辑本文件不再逼 webpack 在每次保存时
 * 重编译编辑器图。
 */
const WorkflowCanvasEditor = dynamic(
  () => import("../canvas/WorkflowCanvasEditor").then((mod) => mod.WorkflowCanvasEditor),
  {
    ssr: false,
    /* 分块还没到时的过渡屏 —— 与编辑器自己的加载态同一口径（ISSUE #1691 第 3 条）：
     * **吃满内容列、不当整窗浮层**。`FullScreenLayer` 会连同侧栏与视图页签一起盖掉，
     * 而用户要的是「加载只覆盖右侧部分」。编辑器**加载完成后**仍是全屏视图
     * （那是它的形态，ISSUE #310），改的只是过渡那一段。
     *
     * 这张过渡屏**只在编辑器真的要开时才该出现** —— 调用处因此按 `editingId`
     * 挂载（见下方渲染点），不能让它常驻：`dynamic()` 的分块是「一渲染就下载」，
     * 而编辑器是通过态的模态，未打开时它本该什么都不做。常驻的代价是**打开工作流库
     * 的那一两秒里，整条内容列（列表 + 详情）被一张「加载工作流编辑器…」盖住**
     * （用户实测口径：「这只是部分区域内容加载中，不要用全屏加载窗口」）。 */
    loading: () => (
      <div className="bg-bg absolute inset-0 flex items-center justify-center">
        <PageLoading label="加载工作流编辑器…" />
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
    <WorkspaceFrame>
      <WorkflowLibraryHeader
        modelFilter={c.modelFilter}
        modelTags={c.modelTags}
        onManageModels={() => {
          c.setShowModelManager(true);
        }}
        onModelFilterChange={c.setModelFilter}
        onSourceFilterChange={c.setSourceFilter}
        onToggleImport={c.toggleImport}
        onTypeFilterChange={c.setTypeFilter}
        sourceCounts={c.sourceCounts}
        sourceFilter={c.sourceFilter}
        typeCounts={c.typeCounts}
        typeFilter={c.typeFilter}
      />

      {c.showImport && (
        <WorkflowImportPanel
          onClose={c.closeImport}
          onImport={c.importState.handleImport}
          state={c.importState}
        />
      )}

      <DeleteWorkflowModal
        deleting={c.deleting}
        onCancel={c.cancelDelete}
        onConfirm={(id) => {
          void c.confirmDelete(id);
        }}
        pendingDelete={c.pendingDelete}
      />

      {/* 动作失败提示：只有用户点「重试」才消失（§17.5.4），
       *  否则防抖期内的后台拉取一成功就会把它吞掉。 */}
      {c.actionError && (
        <div className="border-destructive/25 bg-destructive/8 text-destructive flex items-start gap-2 border-b px-5 py-2.5 text-xs">
          <span className="font-semibold">⚠</span>
          <span className="min-w-0 flex-1">{c.actionError}</span>
          <Button
            className="text-2xs h-auto shrink-0 rounded-md px-2 py-0.5"
            onClick={c.refresh}
            size="xs"
            variant="danger"
          >
            重试
          </Button>
        </div>
      )}

      {c.loadError && !c.actionError && (
        <div className="border-warning/25 bg-warning/8 text-warning-strong flex items-start gap-2 border-b px-5 py-2.5 text-xs">
          <span className="font-semibold">⚠</span>
          <span className="min-w-0 flex-1">{c.loadError}</span>
        </div>
      )}

      <ResizablePanelGroup className="min-h-0 flex-1" orientation="horizontal">
        {/* react-resizable-panels v4：数值 = 像素、字符串 = 百分比。这里必须用
         * 字符串百分比，否则 v4 把 24/16/45 当像素，列表被夹到 45px（issue #981）。 */}
        <ResizablePanel defaultSize="24" maxSize="45" minSize="16">
          <WorkflowLibraryList
            /* 拖入 JSON 导入：整片列表侧栏就是投放区（与导入面板同一漏斗）。 */
            dragActive={c.importState.listDragActive}
            fileErr={c.importState.dropErr}
            loading={c.loading}
            localRootsHint={c.localRootsHint}
            onDragEnter={c.importState.onListDragEnter}
            onDragLeave={c.importState.onListDragLeave}
            onDragOver={c.importState.onListDragOver}
            onDrop={c.importState.onListDrop}
            onLoadPending={(pending) => {
              void c.handleLoadPending(pending);
            }}
            onRefresh={c.refresh}
            onSearchChange={c.setSearch}
            onSelect={c.setSelectedId}
            pendingLoading={c.pendingLoading}
            pendingRows={c.pendingRows}
            search={c.search}
            selectedId={c.selectedId}
            stalled={c.loadStalled}
            workflows={c.workflows}
          />
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel defaultSize="76" minSize="40">
          {/* `min-w-0` 必须有：详情面板是弹性项，默认 `min-width: auto` 会让它**不
            肯窄于内容的最小宽度**（面板里的画布预览、卡片列都不小），于是整行宽度
            超过窗口、右半部分连同头部按钮一起被根容器的 `overflow-hidden` 裁掉
            ——用户在小屏上「看不到最右侧的内容」就是这个成因。 */}
          <div className="h-full min-w-0 overflow-hidden">
            <WorkflowLibraryDetail
              allModelTags={c.modelTags}
              isBundleBusy={c.isBundleBusy}
              isResyncBusy={c.isResyncBusy}
              onDelete={c.handleDeleteClick}
              onDownload={(id, name) => {
                void c.handleDownload(id, name);
              }}
              onEdit={c.handleEdit}
              onPatchModelTags={c.patchModelTags}
              onPatchModes={c.patchModes}
              onPatchParamMap={c.patchParamMap}
              onPatchWorkflowIO={c.patchWorkflowIO}
              onResync={(id, name) => {
                void c.handleResync(id, name);
              }}
              onUse={c.handleUse}
              workflow={c.selectedRow}
            />
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>

      {/* 编辑器只在真的打开时才挂载（`c.editingId` 非空）。此前它常驻、
       *  靠 `open={false}` 自行返回 `null` —— 但 `dynamic()` 的**分块是在组件
       *  首次渲染时下载的**，于是「打开工作流库」这一步就把 7k 行编辑器的分块
       *  拉了下来，过渡屏（`absolute inset-0`）顺势盖住整条内容列。
       *  按需挂载之后，这一步不发生任何下载；用户点「编辑」时才付这一次代价。 */}
      {c.editingId && (
        <WorkflowCanvasEditor
          onClose={c.handleEditorClose}
          onSave={c.load}
          open
          workflowId={c.editingId}
        />
      )}

      {c.showModelManager && (
        <ModelTagManager
          initialTags={c.modelTags}
          onChanged={c.loadModelTags}
          onClose={() => {
            c.setShowModelManager(false);
          }}
        />
      )}
    </WorkspaceFrame>
  );
}
