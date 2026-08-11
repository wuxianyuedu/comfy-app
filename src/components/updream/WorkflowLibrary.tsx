"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { AuroraBackground } from "@/components/updream/AuroraBackground";
import { Icon } from "@/components/ui/Icon";
import { DarkSelect } from "@/components/updream/ui/DarkSelect";
import { WorkflowPreview } from "@/components/updream/ui/WorkflowPreview";
import { WorkflowCanvasEditor } from "./WorkflowCanvasEditor";
import { CustomNodesSettings } from "@/components/workflow-canvas/CustomNodesSettings";
import { useToast } from "@/components/updream/Toast";
import { SourceModal } from "@/components/updream/SourceModal";
import type { WorkflowPreview as WorkflowPreviewT } from "@/lib/comfyui/workflow";
import type { WorkflowIOMap } from "@/components/updream/shared/workflow-io";
import { splitWorkflowIO, ioLabel } from "@/components/updream/shared/workflow-io";

interface WorkflowRow {
  id: string;
  name: string;
  taskType: string;
  createdAt: string;
  paramMap?: Record<string, string> | null;
  preview?: WorkflowPreviewT;
  /** 2026-08-09: user-curated external IO, returned by GET /api/workflows.
   *  Used to render the library card when no graph preview is available. */
  workflowIO?: WorkflowIOMap;
  /** Independent booleans (2026-08-09).  `hasApi` controls whether the
   *  workflow is actually executable; `hasRaw` is informational and lets
   *  the UI offer source-view / download-merged-bundle for RAW imports. */
  hasApi?: boolean;
  hasRaw?: boolean;
  /** Where the executable graph came from (2026-08-09).
   *   - "user": the user explicitly exported API Format from ComfyUI
   *   - "derived": auto-derived from rawJson via convertRawToApi
   *   - null: no API at all (only RAW was imported, graph was empty)
   *  The card and the source modal both use this to honestly label
   *  the API badge so users aren't surprised that "我只导入了 raw"
   *  still shows an API badge. */
  apiOrigin?: "user" | "derived" | null;
  /** Convenience union of the two flags: true ⇔ has an executable graph. */
  usable?: boolean;
  /** "raw" if the user originally imported the UI/raw format (positions
   *  preserved).  "api" otherwise.  This is kept as a legacy hint — UI
   *  should prefer `hasApi/hasRaw` since this single tag can't distinguish
   *  "both" from "only RAW". */
  format?: "raw" | "api";
  /** Absolute path of the on-disk file the workflow was imported from.
   *  Set by any import that touched a real file (the source-local ⤓ 载入
   *  card, or future ad-hoc imports).  When set, the server tracks the
   *  file and re-imports it whenever it changes on disk. */
  sourcePath?: string | null;
  /** 2026-08-10 R11: which configured LOCAL_WORKFLOWS_PATH entry (verbatim
   *  raw path) this file lives under.  The server stamps this on every
   *  already-imported local workflow.  Same value for all rows from the
   *  same configured root — used by the card to label "📂 from which
   *  directory". undefined when the file isn't matched against any root
   *  (e.g. an older import done before LOCAL_WORKFLOWS_PATH was set). */
  sourceRoot?: string | null;
  /** Classification: "local" = tied to an on-disk file; "online" = pasted /
   *  API-only import. Derived from `sourcePath` presence. */
  source?: "local" | "online";
  /** 2026-08-10 R16: manual-sync support.  `diskDirty = (diskMtimeSec >
   *  sourceMtimeSec)` means the on-disk file changed since the last
   *  reimport; the card then surfaces a "↻ 同步" action that POSTs to
   *  /api/workflows/[id]/resync.  All four fields are null/false for
   *  online rows (no sourcePath). */
  diskDirty?: boolean;
  diskMissing?: boolean;
  diskMtimeSec?: number | null;
  sourceMtimeSec?: number | null;
}

/** Resolve the three independent UI booleans + apiOrigin when the server
 *  only sent the legacy single `format` tag.  Treats `format:"raw"` as
 *  "definitely has RAW, has API" — defaults `hasApi=true` because older
 *  imports always went through the raw→api converter.  New callers should
 *  pass `hasApi/hasRaw/apiOrigin` directly. */
function deriveFormatFlags(row: WorkflowRow): {
  hasApi: boolean;
  hasRaw: boolean;
  apiOrigin: "user" | "derived" | null;
  usable: boolean;
} {
  if (typeof row.hasApi === "boolean" || typeof row.hasRaw === "boolean") {
    const hasApi = row.hasApi ?? true;
    const hasRaw = row.hasRaw ?? row.format === "raw";
    const apiOrigin: "user" | "derived" | null = row.apiOrigin
      ?? (hasApi ? (hasRaw ? "derived" : "user") : null);
    return { hasApi, hasRaw, apiOrigin, usable: hasApi };
  }
  return {
    hasApi: true,
    hasRaw: row.format === "raw",
    apiOrigin: row.format === "raw" ? "derived" : "user",
    usable: true,
  };
}

/* 2026-08-10 R16: aggregate the four manual-sync fields into UI booleans.
 *  Online rows (no sourcePath) get `dirty=false, missing=false,
 *  canResync=false`; missing-on-disk rows stay dirty=false but flag
 *  missing so the card can show "📁 文件已不存在" instead of a sync
 *  button. */
function deriveSyncFlags(row: WorkflowRow): {
  dirty: boolean;
  missing: boolean;
  canResync: boolean;
} {
  const dirty = !!row.diskDirty;
  const missing = !!row.diskMissing;
  return { dirty, missing, canResync: dirty };
}

/* ── WorkflowIOThumb (2026-08-09) ──
 * When a workflow row has no graph preview (no API graph or no preview-built
 * fixtures) but DOES have user-curated IO, render the inputs/outputs as a
 * tiny "input chips → output chips" strip so the library card honestly
 * shows what the workflow accepts and produces.  Mirrors the colour
 * palette of `DynamicWorkflowForm`. */
function WorkflowIOThumb({ io }: { io: WorkflowIOMap | null | undefined }) {
  const { inputs, outputs } = useMemo(
    () => splitWorkflowIO(io ?? null),
    [io],
  );
  if (!io || (inputs.length === 0 && outputs.length === 0)) return null;
  /* Cap to keep the card legible; show "+N more" when truncated. */
  const MAX = 4;
  const hiddenIn = Math.max(0, inputs.length - MAX);
  const hiddenOut = Math.max(0, outputs.length - MAX);
  return (
    <div className="flex w-full items-center gap-2 px-3 py-1.5">
      <div className="flex min-w-0 max-w-[44%] flex-wrap items-center justify-end gap-1">
        {inputs.slice(0, MAX).map((e) => (
          <span
            key={e.ioKey}
            className="inline-flex max-w-full items-center gap-1 truncate rounded-md bg-[#5BC6FF]/10 px-1.5 py-0.5 text-[10px] text-[#5BC6FF]"
            title={`${e.nodeTitle ?? ""} · ${e.name}`}
          >
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#5BC6FF]" />
            <span className="truncate">{ioLabel(e)}</span>
          </span>
        ))}
        {hiddenIn > 0 && (
          <span className="text-[10px] text-gray-500">+{hiddenIn}</span>
        )}
      </div>
      <div className="flex h-3 flex-1 items-center">
        <div className="h-px w-full bg-gradient-to-r from-[#5BC6FF]/40 via-white/20 to-[#10B981]/40" />
      </div>
      <div className="flex min-w-0 max-w-[44%] flex-wrap items-center justify-start gap-1">
        {outputs.slice(0, MAX).map((e) => (
          <span
            key={e.ioKey}
            className="inline-flex max-w-full items-center gap-1 truncate rounded-md bg-[#5BE3C4]/10 px-1.5 py-0.5 text-[10px] text-[#5BE3C4]"
            title={`${e.nodeTitle ?? ""} · ${e.name}`}
          >
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#5BE3C4]" />
            <span className="truncate">{ioLabel(e)}</span>
          </span>
        ))}
        {hiddenOut > 0 && (
          <span className="text-[10px] text-gray-500">+{hiddenOut}</span>
        )}
      </div>
    </div>
  );
}

/* SourceRootChip was used in R11 to put a small "📂 来源目录" pill on every
 * local-source card.  In R13 we moved that information into the per-root
 * `RootGroupHeader` above each group, so each card no longer carries the
 * directory by itself — the group header owns it.  The component is no
 * longer used anywhere; kept here only as a reference for future similar
 * chips. */

/** R13 — collapsible group header for one LOCAL_WORKFLOWS_PATH root.
 *  The whole row is the click target (button), caret rotates on toggle, and
 *  the count chip tells the user how many cards are hidden.  When a root
 *  is missing on disk (`exists === false`) we add an amber dot and replace
 *  the count with "目录不存在" so the user understands why no cards showed
 *  up under that header. */
function RootGroupHeader({
  rawPath,
  count,
  exists,
  error,
  collapsed,
  onToggle,
}: {
  rawPath: string | null;          // null = orphan bucket
  count: number;
  exists?: boolean;
  error?: string;
  collapsed: boolean;
  onToggle: () => void;
}) {
  const display = rawPath ? rawPath : "未分组（来源目录已不在配置中）";
  // R14: 不再 JS 硬切前 26 字符（之前 `…` + slice(-54) 会砍掉 `D:\…` 前缀）。
  // 父容器 `flex-1 min-w-0` + 子元素 `truncate` 已按可视宽度自动 ellipsis，
  // 保留最有判别力的 `D:\…` 前缀；只有超宽时末端才出省略号。`title` hover 仍看全路径。
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={!collapsed}
      className="group/root flex w-full items-center gap-2.5 rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-left transition-colors hover:border-cyan-400/30 hover:bg-white/[0.04]"
    >
      <span
        className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-[11px] font-bold transition-transform ${
          collapsed ? "" : "rotate-90"
        } bg-white/[0.06] text-gray-300`}
        aria-hidden
      >
        ▶
      </span>
      <span className="text-[15px]" aria-hidden>
        📁
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span
          className={`truncate font-mono text-[12px] ${
            rawPath ? "text-gray-200" : "text-amber-300"
          }`}
          title={display}
        >
          {display}
        </span>
        {rawPath && (
          <span
            className={`mt-0.5 inline-flex items-center gap-1 text-[10px] ${
              error
                ? "text-red-400"
                : exists === false
                  ? "text-amber-300"
                  : "text-gray-500"
            }`}
          >
            <span
              className={`inline-block h-1.5 w-1.5 rounded-full ${
                error
                  ? "bg-red-400"
                  : exists === false
                    ? "bg-amber-400"
                    : "bg-emerald-400"
              }`}
            />
            {error
              ? error
              : exists === false
                ? "目录不存在"
                : `只读扫描 · 找到 ${count} 个文件`}
          </span>
        )}
      </span>
      <span
        className={`shrink-0 rounded-md px-2 py-0.5 text-[11px] font-medium ${
          collapsed
            ? "bg-white/[0.05] text-gray-400"
            : "bg-cyan-500/15 text-cyan-300"
        }`}
        title={collapsed ? "已折叠，点击展开" : "已展开，点击折叠"}
      >
        {collapsed ? `▸ ${count}` : `▼ ${count}`}
      </span>
    </button>
  );
}

const TASK_LABELS: Record<string, { label: string; color: string }> = {
  TXT2IMG: { label: "文生图", color: "text-violet-300 bg-violet-500/15" },
  IMG2IMG: { label: "图生图", color: "text-emerald-300 bg-emerald-500/15" },
};

/** ComfyUI default filenames start with a "date_slug" prefix and contain only
 *  lowercase letters / underscores / digits.  When we see such a name we
 *  render it in a slightly different style (code font + brighter color) so
 *  it's easier to read at a glance. */
function isTechnicalName(name: string): boolean {
  if (!name) return false;
  if (name.length > 38) return false; // already a descriptive name
  return /^[a-z0-9_]+$/.test(name);
}

function ago(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "刚刚导入";
  if (m < 60) return `${m} 分钟前导入`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} 小时前导入`;
  return `${Math.floor(h / 24)} 天前导入`;
}

/** Modal that shows a workflow's API / RAW source JSON with pretty-print,
 *  copy and per-file download.  The combined-bundle download reuses the same
 *  detail endpoint (and the card's `下载合并包` action).
 *
 *  Performance notes (2026-08-09):
 *  - The previous implementation rendered a 30-100 kB JSON with
 *    `<pre>{JSON.stringify(...)}</pre>`; React had to hold the whole text
 *    node in memory, the browser had to layout/paint every line, and the
 *    text was re-stringified on every state change (tab switch, copy, etc.).
 *  - This rewrite:
 *      1. Uses a read-only `<textarea>` for the JSON: it has built-in
 *         virtualised text rendering, scroll selection, and copy support,
 *         so a 100 kB JSON opens without GC pressure.
 *      2. Memoises the pretty-printed strings for each tab so tab switches
 *         and copy clicks don't re-stringify the entire payload.
 *      3. Caps the body height so the parent backdrop never reflows. */
/**
 * Library-side wrapper around the new reusable `SourceModal` (R40).  The
 * library is the only consumer that needs a network fetch — canvas opens
 * the modal from in-memory store data.
 *
 * R39 history: this used to be a giant inline modal with a `<textarea>`;
 * R39 swapped the body for `JsonViewer`. R40 then extracted the modal so
 * canvas could open it too without forking the rendering code. */
function LibrarySourceModal({
  wf,
  onClose,
}: {
  wf: { id: string; name: string };
  onClose: () => void;
}) {
  const [data, setData] = useState<{ graph: unknown; rawJson: unknown; name: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  useEffect(() => {
    let alive = true;
    setLoading(true);
    fetch(`/api/workflows/${wf.id}`, { cache: "default" })
      .then((r) => r.json())
      .then((d) => {
        if (!alive) return;
        if (d && d.error) setErr(d.error);
        else setData({ graph: d.graph, rawJson: d.rawJson, name: d.name ?? wf.name });
      })
      .catch((e: { message?: string }) => alive && setErr(e?.message ?? "加载失败"))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [wf.id]);

  return (
    <SourceModal
      data={data}
      loading={loading}
      error={err}
      onClose={onClose}
    />
  );
}

export function WorkflowLibrary({
  onUse,
}: {
  onUse?: (id: string, meta?: { name: string; taskType: string }) => void;
}) {
  const toast = useToast();
  const [workflows, setWorkflows] = useState<WorkflowRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");

  // ── Source filter: all / local (file-backed) / online (pasted/API) ──
  const [sourceFilter, setSourceFilter] = useState<"all" | "local" | "online">("all");

  // ── Import panel state ──
  const [showImport, setShowImport] = useState(false);
  const [importName, setImportName] = useState("");
  const [importTaskType, setImportTaskType] = useState("TXT2IMG");
  const [importFormat, setImportFormat] = useState<"auto" | "api" | "raw">("auto");
  const [importJson, setImportJson] = useState("");
  const [importing, setImporting] = useState(false);
  const [importErr, setImportErr] = useState("");
  const [importWarn, setImportWarn] = useState<string[]>([]);

  // 2026-08-10 R12: removed the "本机路径" import tab and all drag-and-drop
  // support per the new rule "本地工作流只能通过配置的路径导入".
  // Source-local workflows now show up automatically under the 本地工作流
  // tab as imported rows or as ⤓ 未载入 placeholders that can be 1-click
  // loaded via the existing local-file import path on the server.

  // ── Delete confirm state ──
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

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
    setCollapsedRoots((s) => ({ ...s, [key]: !s[key] }));
  }, []);
  const expandAllRoots = useCallback(() => setCollapsedRoots({}), []);

  const load = useCallback(() => {
    setLoading(true);
    fetch("/api/workflows")
      .then((r) => r.json())
      .then((d) => {
        setWorkflows(d.workflows ?? []);
        setLocalPending(d.localPending ?? []);
        setLocalRoots(d.localRoots ?? []);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    // 2026-08-10 R8: merge DB rows + disk-pending placeholders into one
    // list before filtering by source tab. Pending rows already carry
    // source: "local-pending" — they only show up under the local tab
    // and inside "全部".
    const merged = [
      ...workflows,
      ...localPending.map((p) => ({
        id: p.id,
        name: p.name,
        sourcePath: p.sourcePath,
        /** 2026-08-10 R11: forward the server's sourceRoot stamp onto the
         *  card so SourceRootChip can render 「📂 来源目录」. */
        sourceRoot: p.sourceRoot,
        source: "local-pending" as const,
        pending: true,
        pendingSize: p.pendingSize,
        pendingMtime: p.pendingMtime,
        createdAt: p.pendingMtime
          ? new Date(p.pendingMtime).toISOString()
          : new Date().toISOString(),
        // Placeholders don't have any of these — the card UI branches
        // before reading them.
        taskType: "",
        paramMap: {},
        preview: { nodes: [], edges: [], w: 0, h: 0 },
        workflowIO: {},
      })),
    ];
    const bySource = merged.filter(
      (w) =>
        sourceFilter === "all" ||
        ((w as any).source ?? ((w as any).sourcePath ? "local" : "online")) === sourceFilter ||
        (sourceFilter === "local" && (w as any).source === "local-pending")
    );
    if (!q) return bySource;
    const needle = q.toLowerCase();
    return bySource.filter((w) => w.name.toLowerCase().includes(needle));
  }, [workflows, localPending, q, sourceFilter]);

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
      (w) =>
        (w as any).source === "local" ||
        (w as any).source === "local-pending" ||
        (w.sourcePath != null && (w as any).source !== "online")
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
          (w) => (w.source ?? (w.sourcePath ? "local" : "online")) === "local"
        ).length + localPending.length,
      online: workflows.filter(
        (w) => (w.source ?? (w.sourcePath ? "local" : "online")) === "online"
      ).length,
    };
    return base;
  }, [workflows, localPending]);

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
      const payload: Record<string, unknown> = {
        name: importName.trim() || "未命名工作流",
        taskType: importTaskType,
        graph: parsed,
      };
      if (importFormat !== "auto") payload.format = importFormat;
      const res = await fetch("/api/workflows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const d = await res.json();
      if (!res.ok) {
        setImportErr(d.error ?? "导入失败");
        return;
      }
      if (Array.isArray(d.warnings)) setImportWarn(d.warnings);
      setShowImport(false);
      setImportName("");
      setImportJson("");
      setImportTaskType("TXT2IMG");
      setImportFormat("auto");
      load();
    } catch (e: any) {
      setImportErr(e?.message ?? "导入失败");
    } finally {
      setImporting(false);
    }
  }, [importName, importTaskType, importFormat, importJson, load]);

  const handleDelete = useCallback(
    async (id: string) => {
      setDeleting(true);
      try {
        const res = await fetch(`/api/workflows/${id}`, { method: "DELETE" });
        const d = await res.json();
        if (!res.ok) {
          setImportErr(d.error ?? "删除失败");
          return;
        }
        setPendingDelete(null);
        load();
      } finally {
        setDeleting(false);
      }
    },
    [load]
  );

  /** 2026-08-11 R38: download a single workflow's API OR RAW JSON
   *  (was `downloadBundle` packing both into one file).  Filename pattern
   *  `{name}.api.json` / `{name}.raw.json`.  If the requested format is
   *  null on the server (e.g. user only imported API format → no raw),
   *  the matching button is disabled at the row level via `hasRaw`, so
   *  this branch mostly handles race / data-race edge cases. */
  const downloadJson = useCallback(
    async (id: string, name: string, kind: "api" | "raw") => {
      setBundleBusy(id);
      try {
        const res = await fetch(`/api/workflows/${id}`, { cache: "no-store" });
        const d = await res.json();
        if (!res.ok || !d) {
          toast.error("获取工作流失败", (d && d.error) || "未知错误");
          return;
        }
        const payload = kind === "api" ? d.graph ?? null : d.rawJson ?? null;
        if (payload == null) {
          toast.error(
            `${kind.toUpperCase()} 不可用`,
            kind === "raw" ? "该工作流未保存 RAW 格式" : "graph 为空"
          );
          return;
        }
        const blob = new Blob([JSON.stringify(payload, null, 2)], {
          type: "application/json",
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${d.name ?? name}.${kind}.json`;
        a.click();
        URL.revokeObjectURL(url);
        toast.success(
          `已下载 ${kind.toUpperCase()}`,
          `${d.name ?? name}.${kind}.json`
        );
      } catch (e: any) {
        toast.error("下载失败", e?.message ?? "网络错误");
      } finally {
        setBundleBusy(null);
      }
    },
    [toast]
  );

  /** 2026-08-10 R16: re-import a local workflow's source file and refresh
   *  the card in place.  POST /api/workflows/[id]/resync reads the file
   *  (read-only against disk; writes only to the DB row) and overwrites
   *  graph/rawJson/positions/paramMap/sourceChecksum/sourceMtime.  On
   *  success we re-run `load()` so the rebuilt preview / IO chips /
   *  param-map count reflect the new content immediately. */
  const resyncWorkflow = useCallback(
    async (id: string, name: string) => {
      setResyncBusy(id);
      try {
        const res = await fetch(`/api/workflows/${id}/resync`, {
          method: "POST",
          cache: "no-store",
        });
        const d = await res.json();
        if (!res.ok) {
          toast.error("同步失败", (d && d.error) || "未知错误");
          return;
        }
        if (d?.missing) {
          toast.error(
            "同步失败",
            "磁盘文件已不存在，无法同步（请检查路径或重新载入）"
          );
        } else if (d?.unchanged) {
          toast.info("磁盘文件未变化", name);
        } else if (d?.updated) {
          toast.success("已同步磁盘内容", name);
          await load();
        }
      } catch (e: any) {
        toast.error("同步请求失败", e?.message ?? "网络错误");
      } finally {
        setResyncBusy(null);
      }
    },
    [toast, load]
  );

  /** Load one disk-discovered file into the DB via the existing single-file
   *  import route. The user clicks ⤓ 载入 on a "未载入" placeholder card;
   *  the server then imports and tracks the file so future refreshes auto
   *  re-import on file change (see GET /api/workflows/[id]).
   *  (R12: this replaces the older "本机路径" tab + drag-drop that let the
   *  user import a local file ad-hoc; the only supported flow now is via
   *  the configured LOCAL_WORKFLOWS_PATH roots.) */
  const handleLoadPending = useCallback(
    async (pending: { id: string; name: string; sourcePath: string }) => {
      setPendingLoading((s) => ({ ...s, [pending.id]: true }));
      try {
        const res = await fetch("/api/workflows", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sourcePath: pending.sourcePath,
            name: pending.name,
          }),
        });
        const d = await res.json();
        if (!res.ok) {
          toast.error("载入失败", d.error ?? "未知错误");
          return;
        }
        toast.success(`已载入「${pending.name}」`, "开始跟踪文件变化");
        load();
      } catch (e: any) {
        toast.error("载入失败", e?.message ?? "网络错误");
      } finally {
        setPendingLoading((s) => {
          const cp = { ...s };
          delete cp[pending.id];
          return cp;
        });
      }
    },
    [load, toast]
  );

const renderWorkflowCard = (w: any) => {
  // ── Pending-local branch (simplified) ─────────────────────────────────
  // 2026-08-10 R13 simplified the original R8 layout by removing the
  // 80px icon hero, the chip strip, and the inline source-path line —
  // the directory the file lives under is already shown in the parent
  // group header (RootGroupHeader), so the same info would only be
  // redundant here. The card now reads top-to-bottom as:
  //   title (small + multi-line)  →  status line  →  ⤓ 载入  →  source path.
  if (w.source === "local-pending") {
    const isLoading = !!pendingLoading[w.id];
    return (
      <div
        key={w.id}
        className="group flex flex-col rounded-2xl border border-dashed border-cyan-400/25 bg-white/[0.015] p-3.5 transition-all hover:border-cyan-400/45"
      >
        <h3
          className="break-words text-sm font-semibold leading-snug text-gray-100"
          title={w.name}
        >
          {w.name}
        </h3>
        <p className="mt-0.5 text-[10.5px] text-cyan-300/80">
          未载入 · {w.pendingSize
            ? `${(w.pendingSize / 1024).toFixed(1)} KB`
            : ""}
        </p>
        <button
          type="button"
          disabled={isLoading}
          onClick={() => void handleLoadPending(w)}
          className="mt-3 w-full rounded-lg bg-cyan-500/90 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-cyan-500 disabled:opacity-50"
          title="将该文件导入到数据库，之后会自动跟踪文件改动"
        >
          {isLoading ? "载入中…" : "⤓ 载入"}
        </button>
        <p
          className="mt-1.5 break-all font-mono text-[10px] leading-snug text-gray-500"
          title={w.sourcePath}
        >
          {w.sourcePath}
        </p>
      </div>
    );
  }

  // ── Imported workflow branch ──────────────────────────────────────────
  // Full-fidelity card: 80px preview / chip strip / title / ago / actions.
  // Click the body to open the canvas editor; "使用 →" places a copy on
  // the project canvas (delegated to the parent's `onUse` callback).
  const tl =
    TASK_LABELS[w.taskType] ??
    { label: w.taskType || "其他", color: "text-gray-300 bg-white/10" };
  const paramCount = Object.keys(w.paramMap ?? {}).length;
  return (
    <div
      key={w.id}
      data-workflow-id={w.id}
      className="group flex cursor-pointer flex-col rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4 transition-all hover:border-violet-500/30 hover:bg-white/[0.04]"
      onClick={() => setEditingId(w.id)}
    >
      <div className="relative mb-3 flex h-20 items-center justify-center overflow-hidden rounded-xl bg-gradient-to-br from-violet-500/10 to-sky-500/10">
        {(() => {
          const ioCount = w.workflowIO ? Object.keys(w.workflowIO).length : 0;
          if (ioCount > 0) return <WorkflowIOThumb io={w.workflowIO} />;
          if (w.preview && w.preview.nodes.length > 0)
            return <WorkflowPreview preview={w.preview} />;
          return (
            <Icon
              name="shuffle"
              size={28}
              className="text-violet-300 transition-transform group-hover:scale-105"
            />
          );
        })()}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className={`rounded-md px-2 py-0.5 text-[11px] font-medium ${tl.color}`}>{tl.label}</span>
        <span className="rounded-md bg-white/10 px-2 py-0.5 text-[11px] text-gray-400">
          {paramCount} 个参数位
        </span>
        {/* API / RAW / ⚠仅RAW 三态徽章（2026-08-09）：
            - hasApi ⇔ graph 实际可执行；没有 graph 时不显示 API。
            - RAW 仅作为「额外保留了原始 UI 格式」的提示，与可用性无关。
            - !hasApi && hasRaw 时加 ⚠ 仅 RAW + ring ring-red-500/30，
              明确告知「此工作流不可用」并给出后续导出指引。
            - apiOrigin === "derived" 时 API 徽章旁挂「派生」角标。 */}
        {(() => {
          const { hasApi, hasRaw, apiOrigin } = deriveFormatFlags(w);
          return (
            <>
              {hasApi && (
                <span
                  className="flex items-center gap-1 rounded-md bg-sky-500/15 px-2 py-0.5 text-[11px] font-medium text-sky-300"
                  title={
                    apiOrigin === "derived"
                      ? "API 格式：由原始 (RAW) 工作流自动转换而来的派生 API，用于执行。节点坐标与连接已自动构造。"
                      : "API 格式：你从 ComfyUI 的「导出(API 格式)」拿到的可执行格式（graph）。"
                  }
                >
                  API
                  {apiOrigin === "derived" && (
                    <span
                      className="rounded bg-sky-500/25 px-1 text-[9px] font-semibold uppercase tracking-wide text-sky-200"
                      title="派生 · 由 RAW 自动转换，并非来自 ComfyUI 的 API 格式导出"
                    >
                      派生
                    </span>
                  )}
                </span>
              )}
              {hasRaw && (
                <span
                  className="rounded-md bg-amber-500/15 px-2 py-0.5 text-[11px] font-medium text-amber-300"
                  title="原始格式（可选，保留节点坐标）"
                >
                  RAW
                </span>
              )}
              {!hasApi && hasRaw && (
                <span
                  className="rounded-md bg-red-500/15 px-2 py-0.5 text-[11px] font-semibold text-red-300 ring-1 ring-red-500/30"
                  title="仅有原始 UI 格式，graph 为空。需在 ComfyUI 中右键 → Save (API Format) 重新导出后再使用"
                >
                  ⚠ 仅 RAW
                </span>
              )}
            </>
          );
        })()}
        {(w.source ?? (w.sourcePath ? "local" : "online")) === "local" ? (
          <span
            className="rounded-md bg-emerald-500/15 px-2 py-0.5 text-[11px] font-medium text-emerald-300"
            title={`本地工作流 · 已连接文件：\n${w.sourcePath}\n修改保存后刷新即可同步`}
          >
            本地
          </span>
        ) : (
          <span
            className="rounded-md bg-white/10 px-2 py-0.5 text-[11px] font-medium text-gray-400"
            title="在线工作流 · 粘贴/API 导入，保存在数据库"
          >
            在线
          </span>
        )}
        {/* 2026-08-10 R16: manual-sync chip.
            - dirty   → amber 圆形 dot + 「↻ 文件已修改」chip (clickable);
            - missing → red 圆形 dot + 「📁 文件已不存在」chip (read-only);
            - otherwise nothing. The chip doubles as the entry point into
            the resyncWorkflow handler below. */}
        {(() => {
          const { dirty, missing } = deriveSyncFlags(w);
          if (dirty) {
            return (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  void resyncWorkflow(w.id, w.name);
                }}
                disabled={resyncBusy === w.id}
                className="inline-flex items-center gap-1 rounded-md bg-amber-500/15 px-2 py-0.5 text-[11px] font-medium text-amber-200 transition-colors hover:bg-amber-500/25 disabled:opacity-60"
                title="磁盘文件自上次同步后已改动，点击以最新文件内容覆盖当前 DB 行"
              >
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-300 shadow-[0_0_6px_rgba(251,191,36,0.7)]" />
                {resyncBusy === w.id ? "同步中…" : "↻ 文件已修改"}
              </button>
            );
          }
          if (missing) {
            return (
              <span
                className="inline-flex items-center gap-1 rounded-md bg-red-500/15 px-2 py-0.5 text-[11px] font-medium text-red-300"
                title={`磁盘文件已不存在：\n${w.sourcePath ?? ""}\n请检查路径或重新载入`}
              >
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-red-300" />
                📁 文件已不存在
              </span>
            );
          }
          return null;
        })()}
        {/* 2026-08-10 R13: SourceRootChip removed from the chip strip.
            The directory this row lives under is now part of the
            RootGroupHeader rendered above the card in the local tab;
            repeating it here would be redundant. */}
      </div>
      <h3
        className={`mt-1.5 break-words text-sm font-semibold leading-snug text-gray-100 ${
          isTechnicalName(w.name) ? "font-mono" : ""
        }`}
        style={{ color: "#F4F4F8" }}
        title={w.name}
      >
        {w.name}
      </h3>
      <p className="mt-1 text-xs font-medium text-gray-400">{ago(w.createdAt)}</p>
      <div className="mt-3 space-y-2">
        {(() => {
          const { usable } = deriveFormatFlags(w);
          if (usable) {
            return (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onUse?.(w.id, { name: w.name, taskType: w.taskType });
                }}
                className="w-full rounded-lg bg-violet-500/90 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-violet-500"
                title="跳到画布并放置工作流节点"
              >
                使用 →
              </button>
            );
          }
          return (
            <button
              type="button"
              disabled
              className="w-full cursor-not-allowed rounded-lg bg-white/[0.05] px-3 py-2 text-xs font-semibold text-gray-500"
              title="此工作流 graph 为空，需要在 ComfyUI 中右键 → Save (API Format) 重新导出后才能使用"
            >
              不可用 ↗
            </button>
          );
        })()}
        <div className="flex items-center gap-2.5">
          {/* 2026-08-10 R16: explicit "↻ 同步" entry point.  Renders
              only when the row is locally dirty (disk mtime > DB mtime).
              The amber chip in the strip is the *status*; this button is
              the *action* and stays even when the user collapsed the
              chip visually by accident. */}
          {deriveSyncFlags(w).dirty && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                void resyncWorkflow(w.id, w.name);
              }}
              disabled={resyncBusy === w.id}
              className="text-xs font-medium text-amber-200 transition-colors hover:text-amber-100 disabled:opacity-60"
              title="把磁盘上最新文件内容写回数据库（不改动磁盘文件）"
            >
              {resyncBusy === w.id ? "同步中…" : "↻ 同步"}
            </button>
          )}
          {/* 2026-08-11 R37: 查看源文件按钮 — SourceModal 一直存在却从未挂
              触发按钮，这里补上。点开弹出只读 modal，可切 API/RAW tab、
              复制或下载该 workflow 的 JSON 文件。放在「编辑」之前作为最
              轻的「只读 view」动作。
              2026-08-11 R38: all four footer buttons switched from
              `font-medium` (which inherited 16px from the card body) to
              `text-xs font-medium` (12px).  The card title is `text-sm
              font-semibold` (14px/600) — without the override the four
              action buttons outweighed it visually because they shared
              the same pixel size and added color noise.  `gap-3` →
              `gap-2.5` to tighten spacing for the smaller font. */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setSourceFor({ id: w.id, name: w.name });
            }}
            className="text-xs font-medium text-sky-300 transition-colors hover:text-sky-200"
            title="查看工作流文件内容（API / RAW 两种 JSON）"
          >
            查看
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setEditingId(w.id);
            }}
            className="text-xs font-medium text-violet-300 transition-colors hover:text-violet-200"
            title="在画布中编辑输入输出端口"
          >
            编辑
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setPendingDelete(w.id);
            }}
            className="text-xs font-medium text-gray-300 transition-colors hover:text-red-300"
          >
            删除
          </button>
          {/* 2026-08-11 R38: download was a single `下载合并包` button
              producing a `{ api, raw, name, taskType }` packed blob.
              User feedback — too coarse; users want to download ONE
              format at a time.  Split into `下载API` + `下载RAW`; the
              RAW button disables itself when the row has no rawJson
              (`hasRaw === false` from `deriveFormatFlags`).  Filename
              pattern: `{name}.api.json` / `{name}.raw.json`. */}
          {(() => {
            const { hasRaw } = deriveFormatFlags(w);
            return (
              <>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    void downloadJson(w.id, w.name, "api");
                  }}
                  disabled={bundleBusy === w.id}
                  className="text-xs font-medium text-emerald-300 transition-colors hover:text-emerald-200 disabled:opacity-50"
                  title="下载 API 格式 JSON（即 graph，可直接执行）"
                >
                  {bundleBusy === w.id ? "下载中…" : "下载API"}
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    void downloadJson(w.id, w.name, "raw");
                  }}
                  disabled={bundleBusy === w.id || !hasRaw}
                  className="text-xs font-medium text-emerald-300 transition-colors hover:text-emerald-200 disabled:opacity-40"
                  title={hasRaw ? "下载原始 workflow JSON（保留节点坐标）" : "该工作流未保存 RAW 格式"}
                >
                  下载RAW
                </button>
              </>
            );
          })()}
        </div>
      </div>
    </div>
  );
};

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
              onChange={(e) => setQ(e.target.value)}
              placeholder="搜索工作流名称…"
              className="w-full rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-gray-200 outline-none focus:border-violet-500/40 sm:w-56"
            />
            <button
              type="button"
              onClick={() => setShowImport((v) => !v)}
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
              <h2 className="u-title">导入 ComfyUI 工作流</h2>
              <button
                type="button"
                onClick={() => setShowImport(false)}
                className="text-gray-500 transition-colors hover:text-gray-300"
                title="关闭"
              >
                ✕
              </button>
            </div>

            {/* Common: name + type */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_200px]">
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-400">工作流名称</label>
                <input
                  value={importName}
                  onChange={(e) => setImportName(e.target.value)}
                  placeholder="例如：胶片人像 _v2（留空则用文件名）"
                  className="w-full rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-gray-200 outline-none focus:border-violet-500/40"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-400">类型（可自动识别）</label>
                <DarkSelect
                  value={importTaskType}
                  onChange={setImportTaskType}
                  options={["TXT2IMG", "IMG2IMG", "OTHER"]}
                  labels={{ TXT2IMG: "文生图 (TXT2IMG)", IMG2IMG: "图生图 (IMG2IMG)", OTHER: "其他 / 视频" }}
                />
              </div>
            </div>

            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-[200px_1fr]">
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-400">JSON 格式</label>
                <DarkSelect
                  value={importFormat}
                  onChange={(v) => setImportFormat((v as "auto" | "api" | "raw") ?? "auto")}
                  options={["auto", "api", "raw"]}
                  labels={{ auto: "自动识别", api: "API 格式", raw: "工作流格式(RAW)" }}
                />
              </div>
              <div className="flex items-end">
                <span className="text-xs text-gray-600">
                  ComfyUI → 菜单 → 「导出(API格式)」 或 「导出(工作流格式)」
                </span>
              </div>
            </div>
            <div className="mt-3">
              <textarea
                value={importJson}
                onChange={(e) => setImportJson(e.target.value)}
                rows={8}
                placeholder='API 格式: { "3": { "class_type": "KSampler", "inputs": {...} } }\n\n工作流格式: { "last_node_id": 11, "nodes": [{ "id": 11, "type": "KSampler", "pos": [400, 300], "widgets_values": [...] }], "links": [...] }'
                className="w-full resize-none rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 font-mono text-xs text-gray-200 outline-none focus:border-violet-500/40"
              />
            </div>

            {importErr && <p className="mt-2 text-xs text-red-400">{importErr}</p>}
            {importWarn.length > 0 && (
              <div className="mt-2 rounded-md border border-amber-500/30 bg-amber-500/[0.06] p-2 text-xs text-amber-200">
                <p className="font-medium">导入提示：</p>
                <ul className="mt-1 list-disc pl-4 space-y-0.5">
                  {importWarn.map((w, i) => (
                    <li key={i}>{w}</li>
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

        {/* ── Delete confirm bar ── */}
        {pendingDelete && (
          <div className="mb-5 flex items-center justify-between rounded-xl border border-red-500/30 bg-red-500/[0.06] px-4 py-3">
            <p className="text-sm text-gray-200">确定删除该工作流？此操作不可撤销。</p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setPendingDelete(null)}
                className="rounded-lg border border-white/15 px-3 py-1.5 text-sm text-gray-300 hover:bg-white/5"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => handleDelete(pendingDelete)}
                disabled={deleting}
                className="rounded-lg bg-red-500/90 px-3 py-1.5 text-sm font-semibold text-white hover:bg-red-500 disabled:opacity-50"
              >
                {deleting ? "删除中…" : "确认删除"}
              </button>
            </div>
          </div>
        )}

        {/* ── Source filter tabs: 本地工作流 vs 在线工作流 ── */}
        <div className="mb-4 flex flex-wrap items-center gap-2">
          {([
            { key: "all", label: "全部", count: sourceCounts.all },
            { key: "local", label: "本地工作流", count: sourceCounts.local },
            { key: "online", label: "在线工作流", count: sourceCounts.online },
          ] as const).map((t) => {
            const active = sourceFilter === t.key;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => setSourceFilter(t.key)}
                className={`flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors ${
                  active
                    ? "border-violet-500/60 bg-violet-500/15 text-violet-200"
                    : "border-white/[0.08] bg-white/[0.02] text-gray-400 hover:border-white/20 hover:text-gray-200"
                }`}
              >
                {t.label}
                <span
                  className={`rounded-full px-1.5 text-[11px] tabular-nums ${
                    active ? "bg-violet-500/30 text-violet-100" : "bg-white/10 text-gray-400"
                  }`}
                >
                  {t.count}
                </span>
              </button>
            );
          })}
        </div>

        {/* ── List ── */}
        {loading ? (
          <p className="text-sm text-gray-500">加载中…</p>
        ) : filtered.length === 0 ? (
          <div className="grid min-h-[300px] place-items-center rounded-2xl border border-dashed border-white/[0.08] text-gray-500">
            <div className="text-center">
              <Icon name="files" size={40} className="mx-auto mb-3 text-violet-300/70" />
              <p className="text-lg font-medium text-gray-300">暂无导入的工作流</p>
              <p className="mt-1 text-sm">
                点击右上角「导入工作流」粘贴 JSON；或在「自定义节点 / 本地工作流」中配置本地目录，将自动出现 ⤓ 未载入 卡片。
              </p>
            </div>
          </div>
        ) : sourceFilter === "local" && groupedByRoot.length > 0 ? (
          // 2026-08-10 R13: per-configured-root grouping for the local
          // tab.  Each LOCAL_WORKFLOWS_PATH entry becomes a RootGroupHeader
          // (caret + 📁 + verbatim path + status) whose collapsed state
          // is local to this page session.  Collapsed groups render as
          // header-only (no children); expanded groups show the cards in
          // a 3-up grid that nests INSIDE the section, indented so it's
          // obvious which directory each card belongs to.
          <div className="space-y-6">
            {groupedByRoot.length > 1 && (
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-gray-500">
                  已配置 {groupedByRoot.length} 个目录 · 共{" "}
                  {groupedByRoot.reduce((n, b) => n + b.rows.length, 0)} 个工作流
                </span>
                {Object.values(collapsedRoots).some(Boolean) && (
                  <button
                    type="button"
                    onClick={expandAllRoots}
                    className="text-[11px] text-gray-400 transition-colors hover:text-cyan-300"
                  >
                    全部展开
                  </button>
                )}
              </div>
            )}
            {groupedByRoot.map((b) => {
              const isCollapsed = !!collapsedRoots[b.key];
              return (
                <section key={b.key} className="space-y-3">
                  <RootGroupHeader
                    rawPath={b.rawPath}
                    count={b.rows.length}
                    exists={b.meta?.exists}
                    error={b.meta?.error}
                    collapsed={isCollapsed}
                    onToggle={() => toggleRoot(b.key)}
                  />
                  {!isCollapsed && (
                    <div className="grid grid-cols-1 gap-3 pl-3 sm:grid-cols-2 lg:grid-cols-3">
                      {b.rows.map(renderWorkflowCard)}
                    </div>
                  )}
                </section>
              );
            })}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map(renderWorkflowCard)}
          </div>
        )}
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
    </div>
  );
}
