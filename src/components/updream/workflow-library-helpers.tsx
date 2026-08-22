"use client";

import React, { useMemo } from "react";
import { Icon } from "@/components/ui/Icon";
import { MultiModeSelect } from "@/components/updream/ui/MultiModeSelect";
import { SourceModal } from "@/components/updream/SourceModal";
import type { WorkflowPreview as WorkflowPreviewT } from "@/lib/comfyui/workflow";
import type { WorkflowIOMap } from "@/components/updream/shared/workflow-io";
import { splitWorkflowIO, ioLabel } from "@/components/updream/shared/workflow-io";
import { api } from "~/trpc/react";

export interface WorkflowRow {
  id: string;
  name: string;
  taskType: string;
  /** 2026-08-13: a workflow may declare multiple modes at once.  When
   *  absent or empty, the UI falls back to `[taskType]` for display
   *  (backward compatibility for older rows).  Both `modes` and
   *  `defaultMode` are returned by GET /api/workflows (persisted to
   *  prisma.WorkflowTemplate.modes / .defaultMode). */
  modes?: string[];
  /** Canonical default mode code; must be present in `modes`. Kept in sync
   *  with `taskType` for the legacy single-value filter. */
  defaultMode?: string | null;
  createdAt: string;
  paramMap?: Record<string, string> | null;
  preview?: WorkflowPreviewT;
  /** 2026-08-09: user-curated external IO, returned by GET /api/workflows.
   *  Used to render the library card when no graph preview is available. */
  workflowIO?: WorkflowIOMap;
  /** 2026-08-15: model tag names attached to this workflow (user-level
   *  global tag library, e.g. ["z-image","wan2.2"]).  Returned by
   *  GET /api/workflows.  Drives the library card chips + model filter. */
  modelTags?: string[];
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
  /** R-ardot105 (2026-08-17): the server detected that the source file
   *  was renamed on disk and automatically re-linked the row to the
   *  new path.  `diskRenamedTo` is a human-readable "old.json → new.json"
   *  summary; the UI flashes a one-shot toast so the user knows the
   *  link silently moved.  null for everything else. */
  diskRenamed?: boolean;
  diskRenamedTo?: string | null;
}


/** Resolve the three independent UI booleans + apiOrigin when the server
 *  only sent the legacy single `format` tag.  Treats `format:"raw"` as
 *  "definitely has RAW, has API" — defaults `hasApi=true` because older
 *  imports always went through the raw→api converter.  New callers should
 *  pass `hasApi/hasRaw/apiOrigin` directly. */
export function deriveFormatFlags(row: WorkflowRow): {
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
export function deriveSyncFlags(row: WorkflowRow): {
  dirty: boolean;
  missing: boolean;
  canResync: boolean;
} {
  const dirty = !!row.diskDirty;
  const missing = !!row.diskMissing;
  return { dirty, missing, canResync: dirty };
}

/* ── detectWorkflowFormat (2026-08-12 R71-1, extracted to shared lib in R76) ──
 * Implementation lives in @/lib/workflow-format so the server-side
 * PATCH endpoint can validate the same JSON shape (drag-to-upgrade). */
import { detectWorkflowFormat } from "@/lib/workflow-format";

/* ── WorkflowIOThumb (2026-08-09) ──
 * When a workflow row has no graph preview (no API graph or no preview-built
 * fixtures) but DOES have user-curated IO, render the inputs/outputs as a
 * tiny "input chips → output chips" strip so the library card honestly
 * shows what the workflow accepts and produces.  Mirrors the colour
 * palette of `DynamicWorkflowForm`. */
export function WorkflowIOThumb({ io }: { io: WorkflowIOMap | null | undefined }) {
  const { inputs, outputs } = useMemo(
    () => splitWorkflowIO(io ?? null),
    [io],
  );
  if (!io || (inputs.length === 0 && outputs.length === 0)) return null;
  /* Cap to keep the card legible; show "+N more" when truncated. */
  const MAX = 4;
  const hiddenIn = Math.max(0, inputs.length - MAX);
  const hiddenOut = Math.max(0, outputs.length - MAX);
  /* 2026-08-15: pass the full IO map so two entries that resolve to
   *  the same display label fall back to `name` and stay visually
   *  distinguishable on the card. */
  const conflictList = [...inputs, ...outputs];
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
            <span className="truncate">{ioLabel(e, conflictList)}</span>
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
            <span className="truncate">{ioLabel(e, conflictList)}</span>
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
export function RootGroupHeader({
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

/* 2026-08-13 R*: Removed R70-2's per-category chip helper
 * (TYPE_COLOR / getTypeView / TASK_TYPE_OPTIONS / TASK_TYPE_LABELS).
 * The library card now uses MultiModeSelect which derives accent
 * internally from each mode's category.  Kept the import for legacy
 * normalization helpers (`getWorkflowType`, `normalizeTaskType`) since
 * they're used by `useMemo` filters below. */

/** ComfyUI default filenames start with a "date_slug" prefix and contain only
 *  lowercase letters / underscores / digits.  When we see such a name we
 *  render it in a slightly different style (code font + brighter color) so
 *  it's easier to read at a glance. */
export function isTechnicalName(name: string): boolean {
  if (!name) return false;
  if (name.length > 38) return false; // already a descriptive name
  return /^[a-z0-9_]+$/.test(name);
}

export function ago(iso: string): string {
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
export function LibrarySourceModal({
  wf,
  onClose,
}: {
  wf: { id: string; name: string };
  onClose: () => void;
}) {
  const detailQ = api.workflow.detail.useQuery({ id: wf.id });
  const data = detailQ.data?.template
    ? {
        graph: detailQ.data.template.graph,
        rawJson: detailQ.data.template.rawJson,
        name: detailQ.data.template.name ?? wf.name,
      }
    : null;

  return (
    <SourceModal
      data={data}
      loading={detailQ.isLoading}
      error={detailQ.isError ? (detailQ.error?.message ?? "加载失败") : ""}
      onClose={onClose}
    />
  );
}

/** 2026-08-21 P4-2: extracted from WorkflowLibrary.renderWorkflowCard's
 *  "local-pending" branch. Self-contained: only needs the row plus an
 *  isLoading flag and the load callback. */
export function PendingWorkflowCard({
  w,
  isLoading,
  onLoad,
}: {
  w: WorkflowRow & { pendingSize?: number };
  isLoading: boolean;
  onLoad: () => void;
}) {
  return (
    <div
      key={w.id}
      className="group flex flex-col rounded-2xl border border-dashed border-cyan-400/25 bg-white/[0.015] p-4"
    >
      <h3
        className="break-words text-sm font-semibold leading-snug text-gray-100"
        title={w.name}
      >
        {w.name}
      </h3>
      <p className="mt-0.5 text-[10.5px] text-cyan-300/80">
        未载入 ·{" "}
        {w.pendingSize ? `${(w.pendingSize / 1024).toFixed(1)} KB` : ""}
      </p>
      <button
        type="button"
        disabled={isLoading}
        onClick={onLoad}
        className="mt-3 w-full rounded-lg bg-cyan-500/90 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-cyan-500 disabled:cursor-not-allowed disabled:opacity-60"
        title="将该文件导入到数据库，之后会自动跟踪文件改动"
      >
        {isLoading ? "载入中…" : "⤓ 载入"}
      </button>
      <p
        className="mt-1.5 break-all font-mono text-[10px] leading-snug text-gray-500"
        title={w.sourcePath ?? undefined}
      >
        {w.sourcePath}
      </p>
    </div>
  );
}

/** 2026-08-22 P4: generic pill filter tabs extracted from WorkflowLibrary's
 *  source/type filter rows (identical markup, different accent). */
export function FilterTabs<T extends string>({
  tabs,
  active,
  onChange,
  accent,
  trailing,
}: {
  tabs: readonly { key: T; label: string; count: number }[];
  active: T;
  onChange: (key: T) => void;
  accent: "violet" | "sky" | "fuchsia";
  trailing?: React.ReactNode;
}) {
  const activeCls =
    accent === "violet"
      ? "border-violet-500/60 bg-violet-500/15 text-violet-200"
      : accent === "sky"
        ? "border-sky-500/60 bg-sky-500/15 text-sky-200"
        : "border-fuchsia-500/60 bg-fuchsia-500/15 text-fuchsia-200";
  const badgeCls =
    accent === "violet"
      ? "bg-violet-500/30 text-violet-100"
      : accent === "sky"
        ? "bg-sky-500/30 text-sky-100"
        : "bg-fuchsia-500/30 text-fuchsia-100";
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      {tabs.map((t) => {
        const isActive = active === t.key;
        return (
          <button
            key={t.key}
            type="button"
            onClick={() => onChange(t.key)}
            className={`flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors ${
              isActive
                ? activeCls
                : "border-white/[0.08] bg-white/[0.02] text-gray-400 hover:border-white/20 hover:text-gray-200"
            }`}
          >
            {t.label}
            <span
              className={`rounded-full px-1.5 text-[11px] tabular-nums ${
                isActive ? badgeCls : "bg-white/10 text-gray-400"
              }`}
            >
              {t.count}
            </span>
          </button>
        );
      })}
      {trailing}
    </div>
  );
}

/** 2026-08-21 P4-3: extracted from WorkflowLibrary's list container
 *  (drop banner + grouped/plain list rendering).  All drag-drop handlers,
 *  filters and card renderer are passed in as props. */
export interface WorkflowRowGroup<TRow = WorkflowRow> {
  key: string;
  rawPath: string | null;
  rows: TRow[];
  meta?: { exists?: boolean; error?: string };
}

export function WorkflowListBody<TRow extends { id: string } = WorkflowRow>({
  loading,
  filtered,
  sourceFilter,
  groupedByRoot,
  collapsedRoots,
  expandAllRoots,
  toggleRoot,
  renderCard,
  onListDragEnter,
  onListDragOver,
  onListDragLeave,
  onListDrop,
  dropErr,
  setDropErr,
  dragActive,
}: {
  loading: boolean;
  filtered: TRow[];
  sourceFilter: string;
  groupedByRoot: WorkflowRowGroup<TRow>[];
  collapsedRoots: Record<string, boolean>;
  expandAllRoots: () => void;
  toggleRoot: (key: string) => void;
  renderCard: (w: TRow) => React.ReactNode;
  onListDragEnter: React.DragEventHandler;
  onListDragOver: React.DragEventHandler;
  onListDragLeave: React.DragEventHandler;
  onListDrop: React.DragEventHandler;
  dropErr: string | null;
  setDropErr: (err: string | null) => void;
  dragActive: boolean;
}) {
  return (
    <div
      className="relative"
      onDragEnter={onListDragEnter}
      onDragOver={onListDragOver}
      onDragLeave={onListDragLeave}
      onDrop={onListDrop}
    >
      {dropErr && (
        <div className="mb-3 flex items-start gap-2 rounded-lg border border-red-500/40 bg-red-500/[0.08] px-3 py-2 text-sm text-red-200">
          <span className="font-semibold">⚠</span>
          <span>{dropErr}</span>
          <button
            type="button"
            className="ml-auto text-xs text-red-300/70 hover:text-red-100"
            onClick={() => setDropErr(null)}
          >
            ✕
          </button>
        </div>
      )}

      {/* R72 compact drop hint — 替代 R71-1 的全屏 overlay */}
      {(!loading || filtered.length > 0) && (
        <div
          className={`mb-3 flex items-center gap-3 rounded-xl border border-dashed px-4 py-2.5 transition-colors ${
            dragActive
              ? "border-cyan-400/80 bg-cyan-500/[0.08] shadow-[inset_0_0_0_1px_rgba(34,211,238,0.12)]"
              : "border-white/[0.08] bg-white/[0.02] hover:border-white/[0.16]"
          }`}
        >
          <div
            className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
              dragActive ? "bg-cyan-500/15 text-cyan-300" : "bg-white/[0.04] text-gray-500"
            }`}
          >
            <Icon name="upload" size={16} />
          </div>
          <div className="min-w-0 flex-1">
            <div
              className={`truncate text-sm font-medium ${dragActive ? "text-cyan-100" : "text-gray-300"}`}
            >
              {dragActive ? "松开鼠标即可导入工作流" : "把工作流 JSON 拖到这里快速导入"}
            </div>
            <div
              className={`truncate text-[11px] ${dragActive ? "text-cyan-200/70" : "text-gray-500"}`}
            >
              {dragActive
                ? "支持 ComfyUI 导出（API 格式）/（工作流格式）· 单文件 ≤ 5 MB"
                : "或点击右上角「导入工作流」粘贴 JSON"}
            </div>
          </div>
        </div>
      )}
      {loading && filtered.length === 0 ? (
        <div className="grid min-h-[220px] place-items-center rounded-2xl text-gray-400">
          <div className="flex flex-col items-center gap-3">
            <Icon
              name="loader"
              size={44}
              className="animate-spin text-cyan-300/90"
            />
            <span className="text-sm text-gray-400">加载中…</span>
          </div>
        </div>
      ) : filtered.length === 0 ? (
        <div className="grid min-h-[220px] place-items-center rounded-2xl border border-dashed border-white/[0.08] text-gray-500">
          <div className="text-center">
            <Icon name="files" size={32} className="mx-auto mb-2 text-violet-300/70" />
            <p className="text-base font-medium text-gray-300">暂无工作流</p>
            <p className="mt-1 text-xs">
              配置本地工作流目录后会显示 ⤓ 未载入 卡片；或向上拖入 JSON 导入。
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
                  {b.rows.map(renderCard)}
                </div>
              )}
            </section>
          );
        })}
      </div>
    ) : (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {filtered.map((w) => (
          <React.Fragment key={w.id}>{renderCard(w)}</React.Fragment>
        ))}
      </div>
    )}
    </div>
  );
}
