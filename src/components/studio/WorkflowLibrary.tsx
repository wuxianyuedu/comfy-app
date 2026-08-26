"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AuroraBackground } from "@/components/studio/AuroraBackground";
import { Icon } from "@/components/ui/Icon";
import { DarkSelect } from "@/components/studio/ui/DarkSelect";
import { MultiModeSelect } from "@/components/studio/ui/MultiModeSelect";
import dynamic from "next/dynamic";
import { CustomNodesSettings } from "@/components/workflow-canvas/CustomNodesSettings";
import { useToast } from "@/components/studio/toast-provider";
import { SourceModal } from "@/components/studio/SourceModal";
import { ModelTagManager } from "@/components/studio/ModelTagManager";
import type { WorkflowPreview as WorkflowPreviewT } from "@/lib/comfyui/workflow";
import type { WorkflowIOMap } from "@/components/studio/shared/workflow-io";
import { splitWorkflowIO, ioLabel } from "@/components/studio/shared/workflow-io";
import { getWorkflowType, normalizeTaskType } from "@/lib/workflow-types";
import { api } from "~/trpc/react";
import {
  ago,
  deriveFormatFlags,
  deriveSyncFlags,
  isTechnicalName,
  LibrarySourceModal,
  RootGroupHeader,
  WorkflowIOThumb,
  PendingWorkflowCard,
  FilterTabs,
  WorkflowListBody,
} from "./workflow-library-helpers";
import type { WorkflowRow } from "./workflow-library-helpers";
import { WorkflowCard } from "./workflow-library-card";
import { detectWorkflowFormat } from "@/lib/workflow-format";
import { useWorkflowActions } from "./workflow-library-actions";

/**
 * Lazy-load the canvas editor. It is a 7k-line module; keeping it behind a
 * dynamic import means editing this file (or its sibling `ModelTagManager`)
 * no longer forces webpack to recompile the editor graph on every save —
 * this was the cause of the multi-second Fast Refresh stall reported on
 * delete/tag operations. The editor chunk is only fetched when the modal
 * actually opens.
 */
const WorkflowCanvasEditor = dynamic(
  () => import("./WorkflowCanvasEditor").then((mod) => mod.WorkflowCanvasEditor),
  {
    ssr: false,
    loading: () => (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--color-bg)]">
        <div className="text-center">
          <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-2 border-violet-500/30 border-t-violet-500" />
          <p className="text-sm text-gray-400">加载工作流编辑器…</p>
        </div>
      </div>
    ),
  }
);


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
  const [sourceFilter, setSourceFilter] = useState<"all" | "local" | "online">("all");
  // ── Type filter: all / image / video / audio (R70-3) ──
  const [typeFilter, setTypeFilter] = useState<"all" | "image" | "video" | "audio">("all");
  // ── 2026-08-15 模型筛选：all 或某个模型标签名 ──
  const [modelFilter, setModelFilter] = useState<string>("all");
  // 用户级模型标签库（全局，跨工作流复用）；卡片 chips + 管理弹窗 + 筛选器共享
  const [modelTags, setModelTags] = useState<{ id: string; name: string; count: number }[]>([]);
  const [showModelManager, setShowModelManager] = useState(false);
  // 当前正在编辑标签的卡片 id（card 内的「＋」popover）
  const [assigningId, setAssigningId] = useState<string | null>(null);
  // popover 锚点位置（按钮的视口矩形），用于 portal 固定定位，逃出卡片/滚动裁剪
  const [assignRect, setAssignRect] = useState<{ top: number; left: number; width: number } | null>(null);
  const modelManagerOpenRef = useRef(false);

  // ── Import panel state ──
  const [showImport, setShowImport] = useState(false);
  const [importName, setImportName] = useState("");
  const [importModes, setImportModes] = useState<string[]>([]);
  const [importDefaultMode, setImportDefaultMode] = useState("");
  const [importFormat, setImportFormat] = useState<"auto" | "api" | "raw">("auto");
  const [importJson, setImportJson] = useState("");
  const [importing, setImporting] = useState(false);
  const [importErr, setImportErr] = useState("");
  const [importWarn, setImportWarn] = useState<string[]>([]);
  // 2026-08-25 (#53): the import-panel "?" help was hover-only
  // (pointer-events-none + group-hover).  Clicking did nothing.  Make it a
  // real toggle so a click shows/hides the explanation.
  const [showHelpTip, setShowHelpTip] = useState(false);

  // 2026-08-12 R71-1: 恢复 drag-and-drop 导入（R12 当时移除 drag-drop 是
  // 因为本地工作流只能从配置路径导入；现在用户在「本地工作流」tab 把任意
  // JSON 文件拖进来 → 自动识别格式 → 弹出导入面板让用户确认 → 走现有
  // POST /api/workflows 链路入库）。
  // dragActive 控制整片列表区域的虚线高亮；dropErr 用于「文件解析失败」
  // 时的悬浮错误条（3 秒后自隐）。
  const [dragActive, setDragActive] = useState(false);
  const [dropErr, setDropErr] = useState<string | null>(null);


  // 2026-08-10 R12: removed the "本机路径" import tab and all drag-and-drop
  // support per the new rule "本地工作流只能通过配置的路径导入".
  // Source-local workflows now show up automatically under the 本地工作流
  // tab as imported rows or as ⤓ 未载入 placeholders that can be 1-click
  // loaded via the existing local-file import path on the server.

  // ── Delete confirm state ──
  // 2026-08-12 R77: { id, name } lets the delete modal show which workflow
  // the user is about to remove (previously this was just an `id`, so the
  // confirm bar read "确定删除该工作流？" with no name).
  const [pendingDelete, setPendingDelete] = useState<{ id: string; name: string } | null>(null);
  const [deleting, setDeleting] = useState(false);

  // 2026-08-12 R77: pressing Escape dismisses the delete modal
  // (matches the convention of native <dialog> elements so keyboard users
  // aren't trapped in the modal).
  useEffect(() => {
    if (!pendingDelete) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (pendingDelete) setPendingDelete(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [pendingDelete]);

  // ── Canvas editor state ──
  const [editingId, setEditingId] = useState<string | null>(null);

  // ── Source view modal + combined download state ──
  const [sourceFor, setSourceFor] = useState<{ id: string; name: string } | null>(null);
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
  const [pendingLoading, setPendingLoading] = useState<Record<string, boolean>>({});

  // ── R13: per-configured-root collapse state ────────────────────────────
  // Key = the LOCAL_WORKFLOWS_PATH entry's verbatim raw path (same string
  // stamped on each row's `sourceRoot`).  Value: true = group body hidden,
  // false = cards visible.  Default expanded (`false`); the first key a
  // user collapses persists across reloads until they close the page.
  // The synthetic key "__no_root__" catches orphan rows (older imports
  // whose `sourcePath` predates the server stamp).
  const [collapsedRoots, setCollapsedRoots] = useState<Record<string, boolean>>({});

  const toggleRoot = useCallback((key: string) => {
    setCollapsedRoots((state) => ({ ...state, [key]: !state[key] }));
  }, []);
  const expandAllRoots = useCallback(() => setCollapsedRoots({}), []);

  const load = useCallback(() => {
    setLoading(true);
    // Keep previous list state (do not wipe to empty).  Errors surface via
    // react-query state (`listQ.error`) and the data-sync effect below only
    // runs on success, so a failed refetch leaves the current list intact.
    listQ
      .refetch()
      .catch((err: any) => {
        console.warn(
          "[WorkflowLibrary] /api/workflows fetch failed:",
          err?.message ?? err
        );
      })
      .finally(() => setLoading(false));
  }, [listQ]);

  /** 2026-08-15: 拉取用户级模型标签库（全局），供卡片 chips / 筛选器 /
   *  管理弹窗共享。独立拉取，不与工作流列表耦合。 */
  const loadModelTags = useCallback(() => {
    tagsQ.refetch().catch(() => {});
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

  useEffect(() => {
    if (tagsQ.data && Array.isArray(tagsQ.data.tags)) setModelTags(tagsQ.data.tags);
  }, [tagsQ.data]);

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
      window.removeEventListener("comfyapp:local-workflows-path-changed", onChanged);
    };
  }, [load]);

  // 2026-08-10 R8: merge DB rows + disk-pending placeholders into one list
  // before filtering.  Hoisted into its own memo so R70-3's type counts and
  // the source filter share the same merged set without recomputing.
  const mergedRows = useMemo(
    () => [
      ...workflows,
      ...localPending.map((localPending) =>({        id: localPending.id,
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
        preview: { nodes: [], edges: [], w: 0, h: 0 },
        workflowIO: {},
      })),
    ],
    [workflows, localPending]
  );

  const filtered = useMemo(() => {
    const bySource = mergedRows.filter(
      (workflow) =>
        sourceFilter === "all" ||
        ((workflow as any).source ?? ((workflow as any).sourcePath ? "local" : "online")) === sourceFilter ||
        (sourceFilter === "local" && (workflow as any).source === "local-pending")
    );
    // 2026-08-12 R70-3: filter by high-level category (image / video / audio).
    const byType = bySource.filter((bySource) =>
{
      if (typeFilter === "all") return true;
      const cat = getWorkflowType(normalizeTaskType((bySource as any).taskType ?? ""))?.category;
      return cat === typeFilter;
    });
    // 2026-08-15: filter by model tag name.  "all" = no model constraint;
    // any other value must match one of the row's modelTags (placeholders
    // have none, so they're hidden when a model is selected).
    const byModel = byType.filter((byType) =>
{
      if (modelFilter === "all") return true;
      const tags = ((byType as any).modelTags as string[] | undefined) ?? [];
      return tags.includes(modelFilter);
    });
    if (!q) return byModel;
    const needle = q.toLowerCase();
    return byModel.filter((byModel) => byModel.name.toLowerCase().includes(needle));
  }, [mergedRows, q, sourceFilter, typeFilter, modelFilter]);

  // 2026-08-10 R13: group filtered local rows by their stamped `sourceRoot`.
  // Online rows are intentionally NOT routed through grouping here — the
  // 全部 / 在线 tabs render them in a separate flat panel.  Only when the
  // user is on the "本地" tab does this structure matter; the two
  // consumers below decide which one to use.
  type RootBucket = {
    key: string;             // unique id (rawPath or "__no_root__")
    rawPath: string | null;  // null = orphan bucket
    rows: typeof filtered;
    meta?: { exists: boolean; error?: string };
  };

  const groupedByRoot = useMemo<RootBucket[]>(() => {
    // Only consider rows tagged as local or local-pending; online rows are
    // out of scope of the directory groupings.
    const localRows = filtered.filter(
      (workflow) =>
        (workflow as any).source === "local" ||
        (workflow as any).source === "local-pending" ||
        (workflow.sourcePath != null && (workflow as any).source !== "online")
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
          (workflow) => (workflow.source ?? (workflow.sourcePath ? "local" : "online")) === "local"
        ).length + localPending.length,
      online: workflows.filter(
        (workflow) => (workflow.source ?? (workflow.sourcePath ? "local" : "online")) === "online"
      ).length,
    };
    return base;
  }, [workflows, localPending]);

  // 2026-08-12 R70-3: per-category counts for the type filter chips.  Counts
  // over the same merged set used by `filtered`.
  const typeCounts = useMemo(() => {
    const base = { all: mergedRows.length, image: 0, video: 0, audio: 0 };
    for (const w of mergedRows) {
      const cat = getWorkflowType(normalizeTaskType((w as any).taskType ?? ""))?.category;
      if (cat === "image" || cat === "video" || cat === "audio") base[cat] += 1;
    }
    return base;
  }, [mergedRows]);

  const handleImport = useCallback(async () => {
    setImportErr("");
    setImportWarn([]);
    if (!importJson.trim()) {
      setImportErr("请粘贴 ComfyUI「导出(API格式)」或「导出(工作流格式)」的 JSON");
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(importJson);
    } catch {
      setImportErr("JSON 解析失败，请检查格式");
      return;
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      setImportErr("不是有效的工作流 JSON（应为对象）");
      return;
    }
    setImporting(true);
    try {
      const d = await createMut.mutateAsync({
        name: importName.trim() || "未命名工作流",
        modes: importModes,
        defaultMode: importDefaultMode,
        graph: parsed,
        format: importFormat !== "auto" ? importFormat : undefined,
      });
      if (Array.isArray(d.warnings)) setImportWarn(d.warnings);
      setShowImport(false);
      setImportName("");
      setImportJson("");
      setImportModes(["T2I"]);
      setImportDefaultMode("T2I");
      setImportFormat("auto");
      load();
    } catch (e: any) {
      setImportErr(e?.message ?? "导入失败");
    } finally {
      setImporting(false);
    }
  }, [importName, importModes, importDefaultMode, importFormat, importJson, load]);

  // 2026-08-12 R71-1: drag-and-drop a workflow JSON onto the list area →
  // parse → auto-detect format → pre-fill the existing import panel and
  // open it so the user can confirm name/type/format before POSTing.
  // This intentionally reuses the manual "粘贴 JSON" flow (handleImport
  // above) so all validation, warnings, and error surfaces stay
  // consistent with the copy-paste path. Only the front of the funnel
  // (file → text → JSON → state) is new.
  const handleDroppedFile = useCallback(
    async (file: File) => {
      setDropErr(null);
      if (file.size > 5 * 1024 * 1024) {
        setDropErr(`文件过大（${(file.size / 1024 / 1024).toFixed(1)} MB），单次拖入上限 5 MB`);
        setTimeout(() => setDropErr(null), 4000);
        return;
      }
      let text: string;
      try {
        text = await file.text();
      } catch (e: any) {
        setDropErr("无法读取文件：" + (e?.message ?? "未知错误"));
        setTimeout(() => setDropErr(null), 4000);
        return;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        setDropErr("JSON 解析失败：不是合法的工作流 JSON");
        setTimeout(() => setDropErr(null), 4000);
        return;
      }
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        setDropErr("不是有效的工作流 JSON（应为对象）");
        setTimeout(() => setDropErr(null), 4000);
        return;
      }
      const detected = detectWorkflowFormat(parsed);
      if (!detected) {
        setDropErr("无法识别的工作流格式：既不是 API 也不是 LiteGraph RAW");
        setTimeout(() => setDropErr(null), 4000);
        return;
      }
      // Auto-name from filename (strip extension).
      const baseName = file.name.replace(/\.(json|workflow)$/i, "").trim();
      setImportName(baseName || "未命名工作流");
      setImportFormat(detected); // already "api" | "raw"
      setImportJson(text);
      setImportErr("");
      setImportWarn([]);
      setShowImport(true);
      // Best-effort mode hint: if the JSON hints at image-to-image
      // (upscale / inpaint / img2img), suggest I2I as default; otherwise T2I.
      try {
        let suggested: string = "T2I";
        const obj = parsed as Record<string, unknown>;
        if (detected === "api") {
          for (const v of Object.values(obj)) {
            const ct = (v as any)?.class_type;
            if (typeof ct === "string" && /image|upscale|inpaint|edit/i.test(ct)) {
              suggested = "I2I";
              break;
            }
          }
        } else if (detected === "raw") {
          const nodes = Array.isArray(obj.nodes) ? (obj.nodes as any[]) : [];
          for (const n of nodes) {
            const t = (n as any)?.type;
            if (typeof t === "string" && /image|upscale|inpaint|edit/i.test(t)) {
              suggested = "I2I";
              break;
            }
          }
        }
        setImportModes([suggested]);
        setImportDefaultMode(suggested);
      } catch {
        /* swallow — keep default */
      }
    },
    [],
  );

  // 2026-08-12 R71-1: drag event handlers bound on the list container.
  // onDragOver: must preventDefault to allow drop; only light up when
  // something with `Files` type is being dragged (so text-selection drags
  // don't trigger the highlight). The drag counter on onDragLeave is
  // needed because bubbling from child elements (cards) fires leave events
  // even though the cursor is still inside the drop zone — we walk up
  // to the container's own enter/leave cycle via the counter.
  const dragCounterRef = useRef(0);
  const onListDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    if (!e.dataTransfer.types.includes("Files")) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  }, []);
  const onListDragEnter = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    if (!e.dataTransfer.types.includes("Files")) return;
    dragCounterRef.current += 1;
    setDragActive(true);
  }, []);
  const onListDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    if (!e.dataTransfer.types.includes("Files")) return;
    dragCounterRef.current = Math.max(0, dragCounterRef.current - 1);
    if (dragCounterRef.current === 0) setDragActive(false);
  }, []);
  const onListDrop = useCallback(
    async (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      dragCounterRef.current = 0;
      setDragActive(false);
      const files = Array.from(e.dataTransfer.files ?? []);
      if (files.length === 0) return;
      if (files.length > 1) {
        setDropErr(`一次只能拖入一个文件（收到了 ${files.length} 个）`);
        setTimeout(() => setDropErr(null), 4000);
        return;
      }
      await handleDroppedFile(files[0]!);
    },
    [handleDroppedFile],
  );

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
    setImportErr,
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

const renderWorkflowCard = (w: any) => {
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
        w={w}
        isLoading={!!pendingLoading[w.id]}
        onLoad={() => void handleLoadPending(w)}
      />
    );
  }

  // ── Imported workflow branch ──────────────────────────────────────────
  // Full-fidelity card: 80px preview / chip strip / title / ago / actions.
  // Click the body to open the canvas editor; "使用 →" places a copy on
  // the project canvas (delegated to the parent's `onUse` callback).
  return (
    <WorkflowCard
      w={w}
      isTechnicalName={isTechnicalName}
      normalizeTaskType={normalizeTaskType}
      patchModes={patchModes}
      deriveFormatFlags={deriveFormatFlags}
      deriveSyncFlags={deriveSyncFlags}
      resyncWorkflow={resyncWorkflow}
      resyncBusy={resyncBusy}
      toast={toast}
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
}

    return (
    <div className="relative h-full overflow-y-auto">
      <AuroraBackground />
      <div className="mx-auto max-w-[1200px] px-4 sm:px-8 py-8 sm:py-10">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="font-title text-xl font-bold text-gray-100">工作流库</h1>
            <p className="mt-1 text-sm text-gray-500">
              导入本机 ComfyUI 的自定义工作流：支持「导出(API 格式)」与「导出(工作流格式)」两种 JSON；原始格式会保留节点坐标，画布布局与你 ComfyUI 中看到的一致。
              <span className="ml-1 text-cyan-300/80">· 本地工作流请在「自定义节点 / 本地工作流」中配置目录后自动载入。</span>
            </p>
          </div>
          <div className="flex items-center gap-2">
            <input
              value={q}
              onChange={(event) => setQ(event.target.value)}
              placeholder="搜索工作流名称…"
              className="w-full rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-gray-200 outline-none focus:border-violet-500/40 sm:w-56"
            />
            <button
              type="button"
              onClick={() => setShowImport((value) => !value)}
              className="rounded-lg bg-violet-500/90 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-violet-500"
            >
              ＋ 导入工作流
            </button>
            <CustomNodesSettings />
          </div>
        </div>

        {/* ── Import panel — only "粘贴 JSON" mode remains (R12).
            The "本机路径" tab was removed: local workflows now load
            exclusively from the configured LOCAL_WORKFLOWS_PATH roots
            (see ⤓ 未载入 cards below). */}
        {showImport && (
          <div className="mb-6 rounded-2xl border border-white/[0.08] bg-white/[0.02] p-5">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 className="text-sm font-semibold text-gray-100">导入 ComfyUI 工作流</h2>
              <button
                type="button"
                onClick={() => setShowImport(false)}
                className="text-gray-500 transition-colors hover:text-gray-300"
                title="关闭"
              >
                ✕
              </button>
            </div>

            {/* Common: name + mode */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_220px]">
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-300">工作流名称</label>
                <input
                  value={importName}
                  onChange={(event) => setImportName(event.target.value)}
                  placeholder="例如：胶片人像 _v2（留空则用文件名）"
                  className="w-full rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-gray-100 outline-none placeholder:text-gray-500 focus:border-violet-500/40"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-300">模式</label>
                <MultiModeSelect
                  modes={importModes}
                  defaultMode={importDefaultMode}
                  onChange={(ms, def) => {
                    setImportModes(ms);
                    setImportDefaultMode(def);
                  }}
                />
              </div>
            </div>

            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-[200px_1fr]">
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-400">JSON 格式</label>
                <DarkSelect
                  value={importFormat}
                  onChange={(value) => setImportFormat((value as "auto" | "api" | "raw") ?? "auto")}
                  options={["auto", "api", "raw"]}
                  labels={{ auto: "自动识别", api: "API 格式", raw: "工作流格式(RAW)" }}
                />
              </div>
              <div className="flex items-end">
                <span className="group relative inline-flex items-center gap-1.5 text-xs text-gray-500">
                  <button
                    type="button"
                    onClick={() => setShowHelpTip((value) => !value)}
                    aria-label="导入格式说明"
                    aria-expanded={showHelpTip}
                    className="flex h-5 w-5 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] text-[11px] text-gray-400 transition-colors hover:border-violet-400/40 hover:text-violet-200"
                  >
                    ?
                  </button>
                  <span
                    className={`absolute bottom-full left-0 mb-2 w-64 rounded-lg border border-white/10 bg-[#1b1b24] p-2.5 text-xs leading-relaxed text-gray-300 shadow-xl transition-opacity ${
                      showHelpTip ? "opacity-100" : "pointer-events-none opacity-0 group-hover:opacity-100"
                    }`}
                  >
                    ComfyUI → 菜单 → 「导出(API格式)」 或 「导出(工作流格式)」
                  </span>
                </span>
              </div>
            </div>
            <div className="mt-3">
              <textarea
                value={importJson}
                onChange={(event) => setImportJson(event.target.value)}
                rows={8}
                placeholder='API 格式: { "3": { "class_type": "KSampler", "inputs": {...} } }\n\n工作流格式: { "last_node_id": 11, "nodes": [{ "id": 11, "type": "KSampler", "pos": [400, 300], "widgets_values": [...] }], "links": [...] }'
                className="w-full resize-none rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 font-mono text-xs text-gray-100 outline-none placeholder:text-gray-500 focus:border-violet-500/40"
              />
            </div>

            {importErr && <p className="mt-2 text-xs text-red-400">{importErr}</p>}
            {importWarn.length > 0 && (
              <div className="mt-2 rounded-md border border-amber-500/30 bg-amber-500/[0.06] p-2 text-xs text-amber-200">
                <p className="font-medium">导入提示：</p>
                <ul className="mt-1 list-disc pl-4 space-y-0.5">
                  {importWarn.map((warning, i) => (
                    <li key={`warn-${i}`}>{warning}</li>
                  ))}
                </ul>
              </div>
            )}
            <div className="mt-3 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowImport(false)}
                className="rounded-lg border border-white/15 px-4 py-2 text-sm text-gray-300 transition-colors hover:bg-white/5"
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleImport}
                disabled={importing}
                className="rounded-lg bg-violet-500/90 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-violet-500 disabled:opacity-50"
              >
                {importing ? "导入中…" : "确认导入"}
              </button>
            </div>
          </div>
        )}

        {/* ── Delete confirm modal ── */}
        {pendingDelete && (
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-modal-title"
            onClick={() => !deleting && setPendingDelete(null)}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4 backdrop-blur-sm"
          >
            <div
              onClick={(event) => event.stopPropagation()}
              className="w-full max-w-md rounded-2xl border border-red-500/30 bg-[#16161C] p-5 shadow-[0_24px_60px_rgba(0,0,0,0.6)]"
            >
              <div className="mb-3 flex items-start gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-red-500/15 text-red-300">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <polyline points="3 6 5 6 21 6" />
                    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                    <path d="M10 11v6M14 11v6" />
                    <path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" />
                  </svg>
                </div>
                <div className="min-w-0 flex-1">
                  <h3 id="delete-modal-title" className="text-base font-semibold text-white">
                    删除工作流
                  </h3>
                  <p className="mt-1 break-words text-sm text-gray-400">
                    确认删除「<span className="text-gray-200">{pendingDelete.name}</span>」？此操作不可撤销。
                  </p>
                </div>
              </div>
              <div className="mt-5 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setPendingDelete(null)}
                  disabled={deleting}
                  className="rounded-lg border border-white/15 px-3 py-1.5 text-sm text-gray-300 hover:bg-white/5 disabled:opacity-50"
                >
                  取消
                </button>
                <button
                  type="button"
                  onClick={() => handleDelete(pendingDelete.id)}
                  disabled={deleting}
                  className="rounded-lg bg-red-500/90 px-3 py-1.5 text-sm font-semibold text-white hover:bg-red-500 disabled:opacity-50"
                >
                  {deleting ? "删除中…" : "确认删除"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── Source filter tabs: 本地工作流 vs 在线工作流 ── */}
        <FilterTabs
          tabs={[
            { key: "all", label: "全部", count: sourceCounts.all },
            { key: "local", label: "本地工作流", count: sourceCounts.local },
            { key: "online", label: "在线工作流", count: sourceCounts.online },
          ] as const}
          active={sourceFilter}
          onChange={(key) => setSourceFilter(key)}
          accent="violet"
        />

        {/* ── Type filter (R70-3): 全部类型 / 图像 / 视频 / 音频 ── */}
        <FilterTabs
          tabs={[
            { key: "all", label: "全部类型", count: typeCounts.all },
            { key: "image", label: "图像", count: typeCounts.image },
            { key: "video", label: "视频", count: typeCounts.video },
            { key: "audio", label: "音频", count: typeCounts.audio },
          ] as const}
          active={typeFilter}
          onChange={(key) => setTypeFilter(key)}
          accent="sky"
        />

        {/* ── 2026-08-15 模型筛选 + 标签库管理 ── */}
        <FilterTabs
          tabs={[
            { key: "all", label: "全部模型", count: modelTags.reduce((sum, tag) => sum + tag.count, 0) },
            ...modelTags.map((modelTag) =>({ key: modelTag.name, label: modelTag.name, count: modelTag.count })),
          ]}
          active={modelFilter}
          onChange={(key) => setModelFilter(key === modelFilter ? "all" : key)}
          accent="fuchsia"
          trailing={
            <button
              type="button"
              onClick={() => setShowModelManager(true)}
              className="ml-1 flex items-center gap-1.5 rounded-full border border-white/15 px-3 py-1.5 text-sm font-medium text-gray-300 transition-colors hover:bg-white/5"
            >
              <Icon name="tag" className="h-3.5 w-3.5" />
              管理模型
            </button>
          }
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
          onListDragEnter={onListDragEnter}
          onListDragOver={onListDragOver}
          onListDragLeave={onListDragLeave}
          onListDrop={onListDrop}
          dropErr={dropErr}
          setDropErr={setDropErr}
          dragActive={dragActive}
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
        <LibrarySourceModal
          wf={sourceFor}
          onClose={() => setSourceFor(null)}
        />
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
