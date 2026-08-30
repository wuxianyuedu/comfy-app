"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useToast } from "../ToastProvider";
import { ModelTagManager } from "../ModelTagManager";
import { getWorkflowType, normalizeTaskType } from "@/lib/workflow-types";
import { api } from "~/trpc/react";
import type { WorkflowRow } from "./WorkflowLibraryHelpers";
import { useWorkflowActions } from "./workflow-library-actions";
import { useWorkflowImport } from "./workflow-library-import";
import { WorkflowImportPanel } from "../WorkflowImportPanel";
import { DeleteWorkflowModal } from "../DeleteWorkflowModal";
import { WorkflowLibraryHeader } from "./WorkflowLibraryHeader";
import { WorkflowLibraryFilters } from "./WorkflowLibraryFilters";
import type { SourceFilter, TypeFilter } from "./WorkflowLibraryFilters";
import { WorkflowLibraryList } from "./WorkflowLibraryList";
import { WorkflowLibraryDetail } from "./WorkflowLibraryDetail";

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
 * 2026-08-30: WorkflowLibrary 重新设计为左右分栏布局。
 * 左侧为可搜索的工作流列表，右侧为选中项的详情面板，包含画布节点预览、
 * 参数表单、源文件与操作入口。原有的卡片网格、根目录折叠等交互移除。
 */
export function WorkflowLibrary({
  onUse,
}: {
  onUse?: (id: string, meta?: { name: string; taskType: string }) => void;
}) {
  const toast = useToast();
  const utils = api.useUtils();
  const listQ = api.workflow.list.useQuery(undefined, {
    refetchOnWindowFocus: false,
    staleTime: 30_000,
  });
  const tagsQ = api.workflowModel.list.useQuery(undefined, {
    refetchOnWindowFocus: false,
    staleTime: 30_000,
  });
  const createMut = api.workflow.create.useMutation();
  const updateMut = api.workflow.update.useMutation();
  const deleteMut = api.workflow.delete.useMutation();
  const resyncMut = api.workflow.resync.useMutation();
  const [workflows, setWorkflows] = useState<WorkflowRow[]>([]);
  const [q, setQ] = useState("");

  // ── Source filter: all / local (file-backed) / online (pasted/API) ──
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
  // ── Type filter: all / image / video / audio ──
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  // ── Model tag filter ──
  const [modelFilter, setModelFilter] = useState<string>("all");
  const modelTags = useMemo(
    () =>
      (tagsQ.data?.tags ?? []) as { id: string; name: string; count: number }[],
    [tagsQ.data],
  );
  const [showModelManager, setShowModelManager] = useState(false);

  // ── Delete confirm state ──
  const [pendingDelete, setPendingDelete] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [deleting, setDeleting] = useState(false);

  // ── Canvas editor state ──
  const [editingId, setEditingId] = useState<string | null>(null);

  // ── Download / re-sync busy flags ──
  const [bundleBusy, setBundleBusy] = useState<string | null>(null);
  const [resyncBusy, setResyncBusy] = useState<string | null>(null);

  // ── Local pending placeholders ──
  const [localPending, setLocalPending] = useState<
    Array<{
      id: string;
      name: string;
      sourcePath: string;
      pendingSize?: number;
      pendingMtime?: number;
    }>
  >([]);
  const [, setPendingLoading] = useState<Record<string, boolean>>({});

  // ── Selection state ──
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const load = useCallback(() => {
    listQ.refetch().catch((err: unknown) => {
      const msg =
        err instanceof Error ? err.message : JSON.stringify(err ?? null);
      console.warn("[WorkflowLibrary] /api/workflows fetch failed:", msg);
    });
  }, [listQ]);

  const loadModelTags = useCallback(() => {
    tagsQ.refetch().catch(() => undefined);
  }, [tagsQ]);

  useEffect(() => {
    load();
    loadModelTags();
  }, [load, loadModelTags]);

  /** Sync react-query list data into local UI state. */
  const lastSyncedRef = useRef<string>("");
  useEffect(() => {
    if (!listQ.data) return;
    const snapshot = JSON.stringify({
      wf: listQ.data.workflows ?? [],
      pend: listQ.data.localPending ?? [],
    });
    if (snapshot === lastSyncedRef.current) return;
    lastSyncedRef.current = snapshot;
    setWorkflows((listQ.data.workflows ?? []) as unknown as WorkflowRow[]);
    setLocalPending(listQ.data.localPending ?? []);
    for (const w of listQ.data.workflows ?? []) {
      if (w.diskRenamed && w.diskRenamedTo) {
        toast.success("已自动重新链接", w.diskRenamedTo);
      }
    }
  }, [listQ.data, toast]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onChanged = () => load();
    window.addEventListener("comfyapp:local-workflows-path-changed", onChanged);
    return () => {
      window.removeEventListener(
        "comfyapp:local-workflows-path-changed",
        onChanged,
      );
    };
  }, [load]);

  // Keep selection valid when filters change.
  const selectedRow = useMemo(
    () => workflows.find((w) => w.id === selectedId) ?? null,
    [workflows, selectedId],
  );

  const filteredWorkflows = useMemo(() => {
    const bySource = workflows.filter((workflow) => {
      const source =
        workflow.source ?? (workflow.sourcePath ? "local" : "online");
      return sourceFilter === "all" || source === sourceFilter;
    });
    const byType = bySource.filter((workflow) => {
      if (typeFilter === "all") return true;
      const cat = getWorkflowType(
        normalizeTaskType(workflow.taskType ?? ""),
      )?.category;
      return cat === typeFilter;
    });
    const byModel = byType.filter((workflow) => {
      if (modelFilter === "all") return true;
      return workflow.modelTags?.includes(modelFilter) ?? false;
    });
    if (!q) return byModel;
    const needle = q.toLowerCase();
    return byModel.filter((workflow) =>
      workflow.name.toLowerCase().includes(needle),
    );
  }, [workflows, q, sourceFilter, typeFilter, modelFilter]);

  const pendingRows = useMemo(() => {
    if (sourceFilter === "online") return [];
    const rows = localPending.filter((p) =>
      q ? p.name.toLowerCase().includes(q.toLowerCase()) : true,
    );
    return rows;
  }, [localPending, sourceFilter, q]);

  const sourceCounts = useMemo(() => {
    const base = {
      all: workflows.length + localPending.length,
      local:
        workflows.filter(
          (workflow) =>
            (workflow.source ?? (workflow.sourcePath ? "local" : "online")) ===
            "local",
        ).length + localPending.length,
      online: workflows.filter(
        (workflow) =>
          (workflow.source ?? (workflow.sourcePath ? "local" : "online")) ===
          "online",
      ).length,
    };
    return base;
  }, [workflows, localPending]);

  const typeCounts = useMemo(() => {
    const merged = [
      ...workflows,
      ...localPending.map(() => ({ taskType: "" }) as WorkflowRow),
    ];
    const base = { all: merged.length, image: 0, video: 0, audio: 0 };
    for (const w of merged) {
      const cat = getWorkflowType(
        normalizeTaskType(w.taskType ?? ""),
      )?.category;
      if (cat === "image" || cat === "video" || cat === "audio") base[cat] += 1;
    }
    return base;
  }, [workflows, localPending]);

  const { handleDelete, downloadJson, resyncWorkflow, handleLoadPending } =
    useWorkflowActions({
      setDeleting,
      setPendingDelete,
      setImportErr: () => undefined,
      setBundleBusy,
      setResyncBusy,
      setPendingLoading,
      setWorkflows,
      load,
      updateMut,
      deleteMut,
      resyncMut,
      createMut,
      utils,
    });

  // ── Import panel ──
  const importState = useWorkflowImport({ createMut, load });
  const toggleImport = useCallback(
    () => importState.setShowImport((value) => !value),
    [importState],
  );
  const cancelDelete = useCallback(() => setPendingDelete(null), []);

  const handleUse = useCallback(
    (id: string, meta?: { name: string; taskType: string }) => {
      onUse?.(id, meta);
    },
    [onUse],
  );

  const handleDeleteClick = useCallback(
    (id: string, name: string) => {
      setPendingDelete({ id, name });
      if (selectedId === id) setSelectedId(null);
    },
    [selectedId],
  );

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <WorkflowLibraryHeader onToggleImport={toggleImport} />

      {importState.showImport && (
        <WorkflowImportPanel
          state={importState}
          onClose={() => importState.setShowImport(false)}
          onImport={importState.handleImport}
        />
      )}

      <DeleteWorkflowModal
        pendingDelete={pendingDelete}
        deleting={deleting}
        onConfirm={handleDelete}
        onCancel={cancelDelete}
        onBackdropClick={() => {
          if (!deleting) setPendingDelete(null);
        }}
      />

      <WorkflowLibraryFilters
        sourceFilter={sourceFilter}
        onSourceFilterChange={setSourceFilter}
        sourceCounts={sourceCounts}
        typeFilter={typeFilter}
        onTypeFilterChange={setTypeFilter}
        typeCounts={typeCounts}
        modelFilter={modelFilter}
        onModelFilterChange={setModelFilter}
        modelTags={modelTags}
        onManageModels={() => setShowModelManager(true)}
      />

      <div className="flex min-h-0 flex-1">
        <WorkflowLibraryList
          workflows={filteredWorkflows}
          pendingRows={pendingRows}
          selectedId={selectedId}
          search={q}
          onSearchChange={setQ}
          onSelect={setSelectedId}
          onLoadPending={handleLoadPending}
        />
        <div className="flex-1">
          <WorkflowLibraryDetail
            workflow={selectedRow}
            onUse={handleUse}
            onEdit={setEditingId}
            onDelete={handleDeleteClick}
            onDownload={downloadJson}
            onResync={resyncWorkflow}
            bundleBusy={bundleBusy}
            resyncBusy={resyncBusy}
          />
        </div>
      </div>

      <WorkflowCanvasEditor
        workflowId={editingId ?? ""}
        open={!!editingId}
        onClose={() => setEditingId(null)}
        onSave={load}
      />

      {showModelManager && (
        <ModelTagManager
          initialTags={modelTags}
          onChanged={() => {
            loadModelTags();
          }}
          onClose={() => setShowModelManager(false)}
        />
      )}
    </div>
  );
}
