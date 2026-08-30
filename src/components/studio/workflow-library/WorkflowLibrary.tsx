"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import dynamic from "next/dynamic";
import { AuroraBackground } from "@/components/studio/ui/AuroraBackground";
import { useToast } from "../ToastProvider";
import { ModelTagManager } from "../ModelTagManager";
import { getWorkflowType, normalizeTaskType } from "@/lib/workflow-types";
import { api } from "~/trpc/react";
import {
  ago,
  deriveFormatFlags,
  deriveSyncFlags,
  isTechnicalName,
  LibrarySourceModal,
  PendingWorkflowCard,
  WorkflowListBody,
} from "./WorkflowLibraryHelpers";
import type { WorkflowRow } from "./WorkflowLibraryHelpers";
import { WorkflowCard } from "../WorkflowLibraryCard";
import { useWorkflowActions } from "./workflow-library-actions";
import { useWorkflowImport } from "./workflow-library-import";
import { WorkflowImportPanel } from "../WorkflowImportPanel";
import { DeleteWorkflowModal } from "../DeleteWorkflowModal";
import { WorkflowLibraryHeader } from "./WorkflowLibraryHeader";
import { WorkflowLibraryFilters } from "./WorkflowLibraryFilters";
import type { SourceFilter, TypeFilter } from "./WorkflowLibraryFilters";

/**
 * Lazy-load the canvas editor. It is a 7k-line module; keeping it behind a
 * dynamic import means editing this file (or its sibling `ModelTagManager`)
 * no longer forces webpack to recompile the editor graph on every save —
 * this was the cause of the multi-second Fast Refresh stall reported on
 * delete/tag operations. The editor chunk is only fetched when the modal
 * actually opens.
 */
const WorkflowCanvasEditor = dynamic(
  () =>
    import("../canvas/WorkflowCanvasEditor").then((mod) => mod.WorkflowCanvasEditor),
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
 * 2026-08-29 T12-3: WorkflowLibrary was 973 lines — the import panel JSX,
 * the delete-confirm modal, the page header, the filter rows, and the
 * import/drag-drop logic are now extracted into sibling modules:
 *   - WorkflowImportPanel.tsx      (import panel UI, controlled)
 *   - DeleteWorkflowModal.tsx      (delete-confirm modal)
 *   - WorkflowLibraryHeader.tsx    (title / search / import button)
 *   - WorkflowLibraryFilters.tsx   (source / type / model filter rows)
 *   - workflow-library-import.ts   (useWorkflowImport hook)
 * This file keeps the data plumbing (queries, memos, actions) and the
 * page assembly.  External API (`WorkflowLibrary` export) unchanged.
 */
export function WorkflowLibrary({
  onUse,
}: {
  onUse?: (id: string, meta?: { name: string; taskType: string }) => void;
}) {
  const toast = useToast();
  const utils = api.useUtils();
  const listQ = api.workflow.list.useQuery(undefined, {
    // 2026-08-22: 关闭窗口聚焦自动 refetch + 30s staleTime。
    // 原先默认 refetchOnWindowFocus 会在切回窗口时无谓刷新列表，
    // 造成"闪一下"并可能覆盖用户正在编辑的内容。
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
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");

  // ── Source filter: all / local (file-backed) / online (pasted/API) ──
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
  // ── Type filter: all / image / video / audio (R70-3) ──
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  // ── 2026-08-15 模型筛选：all 或某个模型标签名 ──
  const [modelFilter, setModelFilter] = useState<string>("all");
  // 用户级模型标签库（全局，跨工作流复用）；卡片 chips + 管理弹窗 + 筛选器共享
  // 2026-08-30: 之前硬编码为空数组，导致标签库已有数据时卡片「＋」绑定
  // 菜单仍显示「先到管理模型添加标签」。改为从 tagsQ.data 派生。
  const modelTags = useMemo(
    () => (tagsQ.data?.tags ?? []) as { id: string; name: string; count: number }[],
    [tagsQ.data],
  );
  const [showModelManager, setShowModelManager] = useState(false);
  // 当前正在编辑标签的卡片 id（card 内的「＋」popover）
  const [assigningId, setAssigningId] = useState<string | null>(null);
  // popover 锚点位置（按钮的视口矩形），用于 portal 固定定位，逃出卡片/滚动裁剪
  const [assignRect, setAssignRect] = useState<{
    top: number;
    left: number;
    width: number;
  } | null>(null);

  // 2026-08-10 R12: removed the "本机路径" import tab and all drag-and-drop
  // support per the new rule "本地工作流只能通过配置的路径导入".
  // Source-local workflows now show up automatically under the 本地工作流
  // tab as imported rows or as ⤓ 未载入 placeholders that can be 1-click
  // loaded via the existing local-file import path on the server.

  // ── Delete confirm state ──
  // 2026-08-12 R77: { id, name } lets the delete modal show which workflow
  // the user is about to remove (previously this was just an `id`, so the
  // confirm bar read "确定删除该工作流？" with no name).
  const [pendingDelete, setPendingDelete] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [deleting, setDeleting] = useState(false);

  // ── Canvas editor state ──
  const [editingId, setEditingId] = useState<string | null>(null);

  // ── Source view modal + combined download state ──
  const [sourceFor, setSourceFor] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [bundleBusy, setBundleBusy] = useState<string | null>(null);
  /** 2026-08-10 R16: one busy id for manual re-sync. Triggers the
   *  "↻ 同步" button's spinner on a per-card basis. */
  const [resyncBusy, setResyncBusy] = useState<string | null>(null);
  // 2026-08-10 R8: files discovered under LOCAL_WORKFLOWS_PATH that aren't yet
  // in the database render as "⤓ 未载入" cards inside the 本地工作流 tab.
  // Per-root stats surface a small banner confirming the configured paths
  // are alive (or warning when a path is missing).
  // 2026-08-10 R11: each pending entry carries `sourceRoot` = the verbatim
  // LOCAL_WORKFLOWS_PATH entry it came from, so the card can label the
  // configured directory (rather than the full absPath) in the UI.
  const [localPending, setLocalPending] = useState<
    Array<{
      id: string;
      name: string;
      sourcePath: string;
      sourceRoot?: string;
      pendingSize?: number;
      pendingMtime?: number;
    }>
  >([]);
  const [localRoots, setLocalRoots] = useState<
    Array<{ rawPath: string; exists: boolean; count: number; error?: string }>
  >([]);
  // One busy flag per pending id so a slow import doesn't disable siblings.
  const [pendingLoading, setPendingLoading] = useState<Record<string, boolean>>(
    {},
  );

  // ── R13: per-configured-root collapse state ────────────────────────────
  // Key = the LOCAL_WORKFLOWS_PATH entry's verbatim raw path (same string
  // stamped on each row's `sourceRoot`).  Value: true = group body hidden,
  // false = cards visible.  Default expanded (`false`); the first key a
  // user collapses persists across reloads until they close the page.
  // The synthetic key "__no_root__" catches orphan rows (older imports
  // whose `sourcePath` predates the server stamp).
  const [collapsedRoots, setCollapsedRoots] = useState<Record<string, boolean>>(
    {},
  );

  const toggleRoot = useCallback((key: string) => {
    setCollapsedRoots((state) => ({ ...state, [key]: !state[key] }));
  }, []);
  const expandAllRoots = useCallback(() => setCollapsedRoots({}), []);

  const load = useCallback(() => {
    // Keep previous list state (do not wipe to empty).  Errors surface via
    // react-query state (`listQ.error`) and the data-sync effect below only
    // runs on success, so a failed refetch leaves the current list intact.
    listQ
      .refetch()
      .catch((err: unknown) => {
        const msg =
          err instanceof Error ? err.message : JSON.stringify(err ?? null);
        console.warn("[WorkflowLibrary] /api/workflows fetch failed:", msg);
      })
      .finally(() => setLoading(false));
  }, [listQ]);

  /** 2026-08-15: 拉取用户级模型标签库（全局），供卡片 chips / 筛选器 /
   *  管理弹窗共享。独立拉取，不与工作流列表耦合。 */
  const loadModelTags = useCallback(() => {
    tagsQ.refetch().catch(() => undefined);
  }, [tagsQ]);

  useEffect(() => {
    load();
    loadModelTags();
  }, [load, loadModelTags]);

  /** Sync react-query list data into local UI state (rows / pending /
   *  roots) and surface one-shot disk-relink toasts. */
  const lastSyncedRef = useRef<string>("");
  useEffect(() => {
    if (!listQ.data) return;
    // 2026-08-22: refetch 返回的数据即使内容相同，引用也必然变化，
    // 无条件 setState 会让列表整体重渲染（闪烁感）。这里对内容做
    // 快照比较，真正变化才覆盖本地 state，避免打断用户编辑。
    const snapshot = JSON.stringify({
      wf: listQ.data.workflows ?? [],
      pend: listQ.data.localPending ?? [],
      roots: listQ.data.localRoots ?? [],
    });
    if (snapshot === lastSyncedRef.current) return;
    lastSyncedRef.current = snapshot;
    // tRPC infers Prisma row shapes (JsonValue / Date) which differ from the
    // UI's WorkflowRow contract (Record<string,string> / string).  The wire
    // data is already JSON-safe (superjson), so a single cast is sufficient.
    setWorkflows((listQ.data.workflows ?? []) as unknown as WorkflowRow[]);
    setLocalPending(listQ.data.localPending ?? []);
    setLocalRoots(listQ.data.localRoots ?? []);
    for (const w of listQ.data.workflows ?? []) {
      if (w.diskRenamed && w.diskRenamedTo) {
        toast.success("已自动重新链接", w.diskRenamedTo);
      }
    }
  }, [listQ.data, toast]);

  /** 2026-08-13: re-fetch when a sibling panel mutates LOCAL_WORKFLOWS_PATH.
   *  The settings dialog (CustomNodesSettings) dispatches
   *  `comfyapp:local-workflows-path-changed` after every save; without this
   *  listener the list's `localRoots`/`localPending` state would stay stale
   *  until the user hard-reloads. Both the chip "本地工作流 N" counter and
   *  the "⤓ 未载入" placeholder cards rely on a fresh fetch. */
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onChanged = () => {
      load();
    };
    window.addEventListener("comfyapp:local-workflows-path-changed", onChanged);
    return () => {
      window.removeEventListener(
        "comfyapp:local-workflows-path-changed",
        onChanged,
      );
    };
  }, [load]);

  // 2026-08-10 R8: merge DB rows + disk-pending placeholders into one list
  // before filtering.  Hoisted into its own memo so R70-3's type counts and
  // the source filter share the same merged set without recomputing.
  type LibraryRow = Omit<WorkflowRow, "source"> & {
    /** 2026-08-10: 行的归属来源（服务端行可为 local/online；占位行 local-pending）。 */
    source?: string;
    sourcePath?: string | null;
    sourceRoot?: string | null;
    pending?: boolean;
    pendingSize?: number;
    /** Unix 秒时间戳（占位行由服务端返回；200 行 catch 分支为 Date 字符串时
     *  其将被转 ISO 字符串）。 */
    pendingMtime?: number | string | null;
  };

  const mergedRows = useMemo<LibraryRow[]>(
    () => [
      ...workflows,
      ...localPending.map((localPending) => ({
        id: localPending.id,
        name: localPending.name,
        sourcePath: localPending.sourcePath,
        /** 2026-08-10 R11: forward the server's sourceRoot stamp onto the
         *  card so SourceRootChip can render 「📂 来源目录」. */
        sourceRoot: localPending.sourceRoot,
        source: "local-pending" as const,
        pending: true,
        pendingSize: localPending.pendingSize,
        pendingMtime: localPending.pendingMtime,
        createdAt: localPending.pendingMtime
          ? new Date(localPending.pendingMtime).toISOString()
          : new Date().toISOString(),
        // Placeholders don't have any of these — the card UI branches
        // before reading them.
        taskType: "",
        paramMap: {},
        preview: {
          nodes: [],
          edges: [],
          total: 0,
          width: 0,
          height: 0,
          truncated: false,
        },
        workflowIO: {},
      })),
    ],
    [workflows, localPending],
  );

  const filtered = useMemo(() => {
    const bySource = mergedRows.filter(
      (workflow) =>
        sourceFilter === "all" ||
        (workflow.source ?? (workflow.sourcePath ? "local" : "online")) ===
          sourceFilter ||
        (sourceFilter === "local" && workflow.source === "local-pending"),
    );
    // 2026-08-12 R70-3: filter by high-level category (image / video / audio).
    const byType = bySource.filter((bySource) => {
      if (typeFilter === "all") return true;
      const cat = getWorkflowType(
        normalizeTaskType(bySource.taskType ?? ""),
      )?.category;
      return cat === typeFilter;
    });
    // 2026-08-15: filter by model tag name.  "all" = no model constraint;
    // any other value must match one of the row's modelTags (placeholders
    // have none, so they're hidden when a model is selected).
    const byModel = byType.filter((byType) => {
      if (modelFilter === "all") return true;
      const tags = byType.modelTags ?? [];
      return tags.includes(modelFilter);
    });
    if (!q) return byModel;
    const needle = q.toLowerCase();
    return byModel.filter((byModel) =>
      byModel.name.toLowerCase().includes(needle),
    );
  }, [mergedRows, q, sourceFilter, typeFilter, modelFilter]);

  // 2026-08-10 R13: group filtered local rows by their stamped `sourceRoot`.
  // Online rows are intentionally NOT routed through grouping here — the
  // 全部 / 在线 tabs render them in a separate flat panel.  Only when the
  // user is on the "本地" tab does this structure matter; the two
  // consumers below decide which one to use.
  type RootBucket = {
    key: string; // unique id (rawPath or "__no_root__")
    rawPath: string | null; // null = orphan bucket
    rows: typeof filtered;
    meta?: { exists: boolean; error?: string };
  };

  const groupedByRoot = useMemo<RootBucket[]>(() => {
    // Only consider rows tagged as local or local-pending; online rows are
    // out of scope of the directory groupings.
    const localRows = filtered.filter(
      (workflow) =>
        workflow.source === "local" ||
        workflow.source === "local-pending" ||
        (workflow.sourcePath != null && workflow.source !== "online"),
    );
    const map = new Map<string, RootBucket>();
    for (const w of localRows) {
      const k = w.sourceRoot ?? "__no_root__";
      if (!map.has(k)) {
        map.set(k, {
          key: k,
          rawPath: w.sourceRoot ?? null,
          rows: [],
        });
      }
      map.get(k)!.rows.push(w);
    }
    // Order = the order the user typed LOCAL_WORKFLOWS_PATH entries in
    // (preserved by `localRoots`). Orphan bucket always last.
    const out: RootBucket[] = [];
    const seen = new Set<string>();
    for (const r of localRoots) {
      if (map.has(r.rawPath)) {
        const b = map.get(r.rawPath)!;
        out.push({ ...b, meta: { exists: r.exists, error: r.error } });
        seen.add(r.rawPath);
      }
    }
    for (const [k, b] of map) {
      if (k === "__no_root__" || seen.has(k)) continue;
      out.push(b);
    }
    if (map.has("__no_root__")) {
      out.push(map.get("__no_root__")!);
    }
    return out;
  }, [filtered, localRoots]);

  const sourceCounts = useMemo(() => {
    // Counts include the pending placeholders under "local" so the count
    // chip honestly reflects everything the user can interact with.
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

  // 2026-08-12 R70-3: per-category counts for the type filter chips.  Counts
  // over the same merged set used by `filtered`.
  const typeCounts = useMemo(() => {
    const base = { all: mergedRows.length, image: 0, video: 0, audio: 0 };
    for (const w of mergedRows) {
      const cat = getWorkflowType(
        normalizeTaskType(w.taskType ?? ""),
      )?.category;
      if (cat === "image" || cat === "video" || cat === "audio") base[cat] += 1;
    }
    return base;
  }, [mergedRows]);

  const {
    handleDelete,
    patchModes,
    patchModelTags,
    downloadJson,
    resyncWorkflow,
    handleLoadPending,
  } = useWorkflowActions({
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

  // ── Import panel + drag-and-drop (R71-1) — logic in the hook, UI in
  //    WorkflowImportPanel; the drop path pre-fills panel state then opens
  //    it so the user can confirm before POSTing. ──
  const importState = useWorkflowImport({ createMut, load });

  const toggleImport = useCallback(
    () => importState.setShowImport((value) => !value),
    [importState],
  );

  const cancelDelete = useCallback(() => setPendingDelete(null), []);

  /**
   * 2026-08-27 T7: LibraryRow 内部使用扩展的 `source` 标签（含 "local-pending"
   * 占位），而 WorkflowCard / PendingWorkflowCard 只接收 WorkflowRow。
   * 这里把库内行投影回 WorkflowRow：`source` 收缩为合法两值，占位特有字段
   * 降级为 undefined 以便传入共享卡片。
   */
  const toWorkflowRow = (
    row: LibraryRow,
  ): WorkflowRow & { pendingSize?: number } => ({
    ...row,
    source: row.source === "online" ? "online" : "local",
    sourcePath: row.sourcePath ?? undefined,
    sourceRoot: row.sourceRoot ?? undefined,
    pendingSize: row.pendingSize,
  });

  const renderWorkflowCard = (w: LibraryRow) => {
    // ── Pending-local branch (simplified) ─────────────────────────────────
    // 2026-08-10 R13 simplified the original R8 layout by removing the
    // 80px icon hero, the chip strip, and the inline source-path line —
    // the directory the file lives under is already shown in the parent
    // group header (RootGroupHeader), so the same info would only be
    // redundant here. The card now reads top-to-bottom as:
    //   title (small + multi-line)  →  status line  →  ⤓ 载入  →  source path.
    if (w.source === "local-pending") {
      return (
        <PendingWorkflowCard
          w={toWorkflowRow(w)}
          isLoading={!!pendingLoading[w.id]}
          onLoad={() => {
            if (!w.sourcePath) return;
            void handleLoadPending({
              id: w.id,
              name: w.name,
              sourcePath: w.sourcePath,
            });
          }}
        />
      );
    }

    // ── Imported workflow branch ──────────────────────────────────────────
    // Full-fidelity card: 80px preview / chip strip / title / ago / actions.
    // Click the body to open the canvas editor; "使用 →" places a copy on
    // the project canvas (delegated to the parent's `onUse` callback).
    return (
      <WorkflowCard
        w={toWorkflowRow(w)}
        isTechnicalName={isTechnicalName}
        normalizeTaskType={normalizeTaskType}
        patchModes={patchModes}
        deriveFormatFlags={deriveFormatFlags}
        deriveSyncFlags={deriveSyncFlags}
        resyncWorkflow={resyncWorkflow}
        resyncBusy={resyncBusy}
        assigningId={assigningId}
        patchModelTags={patchModelTags}
        setAssignRect={setAssignRect}
        setAssigningId={setAssigningId}
        ago={ago}
        onUse={onUse}
        downloadJson={downloadJson}
        bundleBusy={bundleBusy}
        setEditingId={setEditingId}
        setSourceFor={setSourceFor}
        assignRect={assignRect}
        setPendingDelete={setPendingDelete}
        modelTags={modelTags}
      />
    );
  };

  return (
    <div className="relative h-full overflow-y-auto">
      <AuroraBackground />
      <div className="mx-auto max-w-[1200px] px-4 py-8 sm:px-8 sm:py-10">
        <WorkflowLibraryHeader
          q={q}
          onQChange={setQ}
          onToggleImport={toggleImport}
        />

        {/* ── Import panel — only "粘贴 JSON" mode remains (R12).
            The "本机路径" tab was removed: local workflows now load
            exclusively from the configured LOCAL_WORKFLOWS_PATH roots
            (see ⤓ 未载入 cards below). */}
        {importState.showImport && (
          <WorkflowImportPanel
            state={importState}
            onClose={() => importState.setShowImport(false)}
            onImport={importState.handleImport}
          />
        )}

        {/* ── Delete confirm modal ── */}
        <DeleteWorkflowModal
          pendingDelete={pendingDelete}
          deleting={deleting}
          onConfirm={handleDelete}
          onCancel={cancelDelete}
          onBackdropClick={() => {
            if (!deleting) setPendingDelete(null);
          }}
        />

        {/* ── Filter rows: source / type / model ── */}
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

        {/* ── List ── */}
        {/* 2026-08-12 R71-1 + R72: drag-drop 的目标区是整片列表容器，handler
         * 用 counter 防抖防冒泡。R72 把"全屏虚线 + 大 icon + 居中三行文案"
         * 换成了列表顶部一条始终可见的小条 (compact banner)，只在拖入时
         * 整条 cyan 高亮——视觉影响从「盖住整个列表」缩到「一小横条」，
         * 普通态还有"把 JSON 拖到这里导入"的常驻提示。*/}
        <WorkflowListBody
          loading={loading}
          filtered={filtered}
          sourceFilter={sourceFilter}
          groupedByRoot={groupedByRoot}
          collapsedRoots={collapsedRoots}
          expandAllRoots={expandAllRoots}
          toggleRoot={toggleRoot}
          renderCard={renderWorkflowCard}
          onListDragEnter={importState.onListDragEnter}
          onListDragOver={importState.onListDragOver}
          onListDragLeave={importState.onListDragLeave}
          onListDrop={importState.onListDrop}
          dropErr={importState.dropErr}
          setDropErr={importState.setDropErr}
          dragActive={importState.dragActive}
        />
      </div>

      {/* ── Canvas editor modal ── */}
      <WorkflowCanvasEditor
        workflowId={editingId ?? ""}
        open={!!editingId}
        onClose={() => setEditingId(null)}
        onSave={load}
      />

      {/* ── Source view modal ── */}
      {sourceFor && (
        <LibrarySourceModal wf={sourceFor} onClose={() => setSourceFor(null)} />
      )}

      {/* ── 2026-08-15 模型标签库管理弹窗 ── */}
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
