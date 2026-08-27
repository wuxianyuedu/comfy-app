/* eslint-disable @typescript-eslint/no-base-to-string, @typescript-eslint/no-explicit-any, @typescript-eslint/no-floating-promises, @typescript-eslint/no-misused-promises, @typescript-eslint/no-unnecessary-type-assertion, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/prefer-nullish-coalescing */
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  refreshCustomNodes,
  colorFor,
  getCustomNodesManifest,
  type ManifestNodeRaw,
} from "@/config/custom-nodes";

interface PkgReport {
  path: string;
  name: string;
  exists: boolean;
  status: "ok" | "missing" | "error" | "empty";
  nodeCount: number;
  nodeTypes: string[];
  errors: { file: string; error: string }[];
}

interface ParseReport {
  generatedAt: string;
  totalNodes: number;
  pathCount: number;
  errorCount: number;
  packages: PkgReport[];
  parseErrors?: { file: string; error: string }[];
}

interface DiscoveredSubpkg {
  path: string;        // absolute directory
  name: string;
  parent: string;      // absolute parent
  exists: boolean;
  isLeaf: boolean;     // true = scanned dir is itself a package (no .py with NODE_CLASS_MAPPINGS inside)
  fileCount: number;
  packageFileCount: number;
  sizeBytes: number;
  contentHash: string;
  status: "ok" | "missing" | "empty";
}

interface SummaryPkg {
  name: string;
  path: string;
  status: string;
  nodeCount: number;
  nodeTypes: string[];
  errors: unknown[];
  contentHash?: string;
  parsedAt?: string | null;
  parsedFileCount?: number;
  generatedAt?: string;
}

interface SettingsResp {
  settings: { paths: string[]; localWorkflowPaths: string[] };
  summary: {
    generatedAt: string | null;
    totalNodes: number;
    packages: SummaryPkg[];
    missingPaths: string[];
    parseErrors: { file: string; error: string }[];
    sources: string[];
  } | null;
  lastReport: ParseReport | null;
  discoveredByParent: Record<string, DiscoveredSubpkg[]>;
  /** Map: normalised absolute path (forward slashes, lowercased) → loaded SummaryPkg
   *  Lets the UI join discovered subpackages against the manifest and detect
   *  "loaded but out-of-date" using contentHash. */
  byPath: Record<string, SummaryPkg>;
}

/** Visual state derived per subpackage row from the discovered entry + the
 *  loaded manifest entry at the same path. */
type RowState =
  | { kind: "loaded"; savedHash: string; nodeCount: number }
  | { kind: "outdated"; savedHash: string; savedNodeCount: number; diskHash: string }
  | { kind: "unimported" }
  | { kind: "error"; reason: string }
  | { kind: "missing" }
  | { kind: "empty" };

function pathKey(p: string): string {
  if (!p) return "";
  // Match server-side normalisation in route.ts: absolute → lowercased →
  // backslashes to forward slashes. This way the discover output (which carries
  // user-typed casing + native separators) joins the manifest's byPath keys
  // without Windows complaining about case.
  let s = p.replace(/\\/g, "/");
  // drop trailing slash for directory roots
  if (s.length > 1 && s.endsWith("/")) s = s.replace(/\/+$/, "");
  return s.toLowerCase();
}

function deriveRowState(
  sub: DiscoveredSubpkg,
  saved: SummaryPkg | undefined,
): RowState {
  if (!sub.exists || sub.status === "missing") return { kind: "missing" };
  if (sub.status === "empty" && (sub.packageFileCount ?? 0) === 0)
    return { kind: "empty" };
  if (!saved) return { kind: "unimported" };
  if (saved.status === "error") {
    const firstErr = (saved.errors ?? [])[0] as { error?: unknown } | undefined;
    const reason =
      typeof firstErr?.error === "string" ? firstErr.error : "解析出错";
    return { kind: "error", reason };
  }
  if (saved.status === "missing") return { kind: "missing" };
  const savedHash = saved.contentHash || "";
  if (!savedHash || !sub.contentHash) {
    // No hash info on either side — treat as loaded only when status==='ok' on saved
    if (saved.status === "ok") return { kind: "loaded", savedHash: "", nodeCount: saved.nodeCount };
    return { kind: "unimported" };
  }
  if (savedHash === sub.contentHash) {
    return { kind: "loaded", savedHash, nodeCount: saved.nodeCount };
  }
  return {
    kind: "outdated",
    savedHash,
    savedNodeCount: saved.nodeCount,
    diskHash: sub.contentHash,
  };
}

const ROW_STATE_PRESET: Record<
  RowState["kind"],
  { bg: string; fg: string; label: string; chip: string; btn: string; btnLabel: string }
> = {
  loaded: {
    bg: "rgba(16,185,129,0.10)",
    fg: "#10B981",
    label: "✓ 已加载",
    chip: "border-emerald-500/30",
    btn: "border border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/10",
    btnLabel: "重新解析",
  },
  outdated: {
    bg: "rgba(245,158,11,0.10)",
    fg: "#F59E0B",
    label: "↻ 有更新",
    chip: "border-amber-500/40",
    btn: "bg-amber-500 text-white hover:opacity-90",
    btnLabel: "重新解析",
  },
  unimported: {
    bg: "rgba(107,114,128,0.10)",
    fg: "#9CA3AF",
    label: "未导入",
    chip: "border-gray-500/30",
    btn: "bg-primary text-white hover:opacity-90",
    btnLabel: "导入此包",
  },
  error: {
    bg: "rgba(239,68,68,0.10)",
    fg: "#EF4444",
    label: "解析出错",
    chip: "border-red-500/40",
    btn: "bg-primary text-white hover:opacity-90",
    btnLabel: "重新解析",
  },
  missing: {
    bg: "rgba(245,158,11,0.10)",
    fg: "#F59E0B",
    label: "目录不存在",
    chip: "border-amber-500/40",
    btn: "border border-border text-muted cursor-not-allowed",
    btnLabel: "无法解析",
  },
  empty: {
    bg: "rgba(107,114,128,0.08)",
    fg: "#9CA3AF",
    label: "无 NODE_CLASS_MAPPINGS",
    chip: "border-gray-500/30",
    btn: "border border-border text-muted cursor-not-allowed",
    btnLabel: "无可导入节点",
  },
};

const STATUS_STYLE: Record<string, { bg: string; fg: string; label: string }> = {
  ok: { bg: "rgba(16,185,129,0.15)", fg: "#10B981", label: "已加载" },
  missing: { bg: "rgba(245,158,11,0.18)", fg: "#F59E0B", label: "目录不存在" },
  error: { bg: "rgba(239,68,68,0.18)", fg: "#EF4444", label: "解析出错" },
  empty: { bg: "rgba(107,114,128,0.18)", fg: "#9CA3AF", label: "无 NODE_CLASS_MAPPINGS" },
};function nowTimeStr() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function splitPaths(text: string): string[] {
  return text
    .split(/[\n,]/)
    .map((segment) => segment.trim())
    .filter(Boolean);
}

function eqArr(a: string[], b: string[]) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/* ──────────────────────────────────────────────────────────────────────── */
/* NodePreviewCard — a small ComfyUI-style preview of one custom node.       */
/*                                                                            */
/*  Layout mirrors what you see in the official ComfyUI web UI for the same  */
/*  node: solid coloured header (drawn from the node's `category`) with a     */
/*  collapse chevron and category badge, then a body split into two zones:    */
/*                                                                            */
/*    1. typed ports (inputs / outputs without a `widget` field) — drawn as   */
/*       small left/right paired rows with coloured handle dots and an       */
/*       uppercase type badge, mimicking the ComfyUI border on node cards.   */
/*    2. widgets (inputs with `widget` field) — a label + default-value row   */
/*       laid out like the parameter rows on the canvas itself.              */
/*                                                                            */
/*  Default state is collapsed: just the coloured header plus a 1-line tally */
/*  ("3 typed / 7 widgets / 1 output"). Click the header to expand. This      */
/*  matches ComfyUI's own behaviour and keeps the package list scannable    */
/*  even for the 146-node WanVideoWrapper package.                            */
/* ──────────────────────────────────────────────────────────────────────── */
function NodePreviewCard({
  data,
  fallbackName,
  expanded,
  onToggle,
}: {
  data: ManifestNodeRaw | undefined;
  fallbackName: string;
  expanded: boolean;
  onToggle: () => void;
}) {
  const color = colorFor(data?.category);
  const inputs = data?.inputs ?? [];
  const outputs = data?.outputs ?? [];
  const typed = inputs.filter((input) => !input.widget);
  const widgets = inputs.filter((input) => input.widget != null);
  const title = data?.displayName || fallbackName;

  return (
    <div
      className="overflow-hidden rounded-lg font-sans"
      style={{
        background: "rgba(15, 10, 30, 0.95)",
        border: `1px solid ${expanded ? color : "rgba(255,255,255,0.18)"}`,
      }}
    >
      {/* Header — clickable to expand. Solid colour band, category-derived. */}
      <div
        role="button"
        tabIndex={0}
        onClick={onToggle}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onToggle();
          }
        }}
        className="flex cursor-pointer items-center gap-2 px-2.5 outline-none"
        style={{
          height: 28,
          background: color,
          color: "#fff",
        }}
      >
        <span className="text-[11px] leading-none">{expanded ? "▾" : "▸"}</span>
        <span
          className="flex-1 truncate text-[11.5px] font-bold"
          style={{ letterSpacing: 0.2 }}
          title={title}
        >
          {title}
        </span>
        {data?.category && (
          <span
            className="rounded-full px-1.5 py-px text-[8.5px] font-semibold"
            style={{ background: "rgba(0,0,0,0.28)" }}
          >
            {data.category}
          </span>
        )}
        {data?.outputNode && (
          <span
            className="rounded-full px-1.5 py-px text-[8.5px] font-semibold"
            style={{ background: "rgba(255,255,255,0.22)" }}
            title="前端专属 (OUTPUT_NODE)"
          >
            ⇪
          </span>
        )}
      </div>

      {!data ? (
        <div className="px-2.5 py-1.5 text-[10px] italic text-muted">
          清单中未找到该节点（可能解析后未重导入此包）
        </div>
      ) : !expanded ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-2.5 py-1.5 text-[10px] text-white/55">
          <span>
            <span className="font-mono text-white/85">{typed.length}</span> typed
          </span>
          <span>
            <span className="font-mono text-white/85">{widgets.length}</span> widget
          </span>
          <span>
            <span className="font-mono text-white/85">{outputs.length}</span> output
          </span>
        </div>
      ) : (
        <div className="px-2.5 pb-2 pt-1.5">
          {/* Zone 1 — typed ports (inputs left, outputs right) */}
          {(typed.length > 0 || outputs.length > 0) && (
            <div className="mb-1.5 grid" style={{ gridTemplateColumns: "1fr 1fr", gap: 4 }}>
              <div className="flex flex-col gap-[3px]">
                {typed.map((i, idx) => (
                  <PortRow key={`ti-${idx}`} side="in" color={color} type={i.type} name={i.name} />
                ))}
              </div>
              <div className="flex flex-col items-end gap-[3px]">
                {outputs.map((o, idx) => (
                  <PortRow key={`to-${idx}`} side="out" color={color} type={o.type} name={o.name} />
                ))}
              </div>
            </div>
          )}

          {/* Zone 2 — widgets (labelled parameters) */}
          {widgets.length > 0 && (
            <div
              className="flex flex-col gap-[2px] border-t pt-1.5"
              style={{ borderColor: "rgba(255,255,255,0.07)" }}
            >
              {widgets.slice(0, 32).map((w, idx) => (
                <div key={`w-${idx}`} className="flex items-center gap-1.5 text-[10.5px]">
                  <span
                    className="inline-block shrink-0 rounded-full"
                    style={{ width: 6, height: 6, background: color, opacity: 0.7 }}
                  />
                  <span
                    className="min-w-0 flex-1 truncate text-[#CFC9E5]"
                    title={w.name}
                  >
                    {w.name}
                  </span>
                  <WidgetValueChip widget={w.widget ?? null} value={w.default} />
                </div>
              ))}
              {widgets.length > 32 && (
                <div className="pl-3 text-[10px] text-muted">
                  … +{widgets.length - 32} more
                </div>
              )}
            </div>
          )}

          {typed.length === 0 && widgets.length === 0 && outputs.length === 0 && (
            <div className="py-1 text-center text-[10px] italic text-muted">
              无输入 / 输出参数
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** One row in the typed-ports zone — small coloured dot + uppercase type badge
 *  + port name. ComfyUI's actual nodes put the dot at the canvas edge and the
 *  name + type chip on the interior; we mirror that geometry so each port row
 *  reads at a glance which side of the node it belongs to. */
function PortRow({
  side,
  color,
  type,
  name,
}: {
  side: "in" | "out";
  color: string;
  type: string;
  name: string;
}) {
  const isOut = side === "out";
  // ComfyUI uses a fixed cyan-ish for outputs, category-derived for inputs.
  const dotColor = isOut ? "#06B6D4" : color;
  return (
    <div className={`flex min-w-0 items-center gap-1 ${isOut ? "flex-row-reverse" : ""}`}>
      <span
        className="inline-block shrink-0 rounded-full"
        style={{ width: 7, height: 7, background: dotColor }}
      />
      <span
        className="rounded px-1 text-[7.5px] font-bold uppercase leading-tight"
        style={{
          color,
          border: `1px solid ${color}66`,
          letterSpacing: 0.4,
        }}
      >
        {type}
      </span>
      <span
        className={`min-w-0 truncate text-[10.5px] font-semibold ${
          isOut ? "text-right text-[#CFE9FF]" : "text-[#E7E2FB]"
        }`}
        title={name}
        style={isOut ? { textAlign: "right" } : undefined}
      >
        {name}
      </span>
    </div>
  );
}

/** Right-aligned chip showing a widget's default value, styled by widget kind
 *  so the user can tell at a glance: strings / numbers / booleans / selects
 *  each get a distinct colour family. Mirrors how ComfyUI's own node renders
 *  the per-widget value chip. */
function WidgetValueChip({
  widget,
  value,
}: {
  widget: string | null;
  value: unknown;
}) {
  if (widget === "toggle") {
    const on = value === true || value === "true" || value === "True";
    return (
      <span
        className="rounded px-1.5 py-px text-[10px] font-semibold"
        style={{
          background: on ? "rgba(16,185,129,0.18)" : "rgba(239,68,68,0.18)",
          color: on ? "#10B981" : "#EF4444",
          fontFamily: '"SF Mono", ui-monospace, monospace',
        }}
      >
        {on ? "✓" : "✗"}
      </span>
    );
  }
  if (widget === "select") {
    return (
      <span
        className="max-w-[100px] truncate rounded px-1.5 py-px text-[10px] font-semibold"
        style={{
          background: "rgba(168,85,247,0.18)",
          color: "#A855F7",
          fontFamily: '"SF Mono", ui-monospace, monospace',
        }}
        title={value == null ? "" : String(value)}
      >
        {value == null ? "—" : String(value)}
      </span>
    );
  }
  if (widget === "number") {
    return (
      <span
        className="max-w-[100px] truncate rounded px-1.5 py-px text-[10px] font-semibold"
        style={{
          background: "rgba(245,158,11,0.18)",
          color: "#F59E0B",
          fontFamily: '"SF Mono", ui-monospace, monospace',
        }}
        title={value == null ? "" : String(value)}
      >
        {value == null ? "—" : String(value)}
      </span>
    );
  }
  // string / text / image / latent / unknown
  return (
    <span
      className="max-w-[140px] truncate rounded px-1.5 py-px text-[10px]"
      style={{
        background: "rgba(0,0,0,0.4)",
        color: "#C9C2E8",
        fontFamily: '"SF Mono", ui-monospace, monospace',
      }}
      title={value == null ? "" : String(value)}
    >
      {value == null ? "—" : String(value)}
    </span>
  );
}

export function CustomNodesSettings() {
  const [open, setOpen] = useState(false);
  // 2026-08-10 R10: split the dialog body into two focus pages so the local-
  // workflow config (a single textarea) doesn't share scrolling real estate
  // with the heavier parse/manage UI. Default to "workflows" because that's
  // the newer feature the user just enabled.
  const [tab, setTab] = useState<"workflows" | "nodes">("workflows");
  const [pathsText, setPathsText] = useState("");
  const [savedPaths, setSavedPaths] = useState<string[]>([]);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  // 2026-08-10 R8: companion local workflow directory state — same edit
  // pattern as `pathsText`, separate effect / save indicator / time stamp
  // so the two sections feel independent.
  const [localPathsText, setLocalPathsText] = useState("");
  const [savedLocalPaths, setSavedLocalPaths] = useState<string[]>([]);
  const [localSavedAt, setLocalSavedAt] = useState<string | null>(null);
  const [localSaving, setLocalSaving] = useState(false);
  const [localSaveErr, setLocalSaveErr] = useState<string | null>(null);

  const [loading, setLoading] = useState(false);
  // Progress is two-phase, both expressed in PACKAGE counts (NOT file counts):
  //   scan phase → discovered grows; total is unknown until file walk ends.
  //   hash phase → done / total of packages processed.
  // The bar fill switches: indeterminate (CSS animation) during scan, then
  // snaps to a determined K/M when scan announces `total=M`.
  const [progress, setProgress] = useState<{
    phase: "queue" | "scan" | "hash" | "";  // which stage we're in
    done: number;        // packages processed (only meaningful in hash phase)
    total: number;       // packages total (0 during scan until announced)
    discovered: number;  // packages discovered so far (only meaningful in scan phase)
    parent: string;      // current parent path
    msg: string;         // latest human-readable sub-message
  }>({ phase: "", done: 0, total: 0, discovered: 0, parent: "", msg: "" });
  const [parsing, setParsing] = useState(false);
  const [perPkgParsing, setPerPkgParsing] = useState<Record<string, boolean>>({});
  const [report, setReport] = useState<ParseReport | null>(null);
  const [summary, setSummary] = useState<SettingsResp["summary"]>(null);
  const [discoveredByParent, setDiscoveredByParent] = useState<Record<string, DiscoveredSubpkg[]>>({});
  const [byPath, setByPath] = useState<Record<string, SummaryPkg>>({});
  const [expandedParents, setExpandedParents] = useState<Record<string, boolean>>({});

  const [logs, setLogs] = useState<{ level: string; msg: string }[]>([]);
  const consoleRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const logsRef = useRef<HTMLDivElement>(null);

  // Raw manifest (classType → full spec). Independent of the registry populated
  // by `refreshCustomNodes()` — we render preview cards even on a freshly-
  // opened dialog before any consumer has called refresh. Re-fetched after every
  // parse so newly-imported packages show their nodes without a hard reload.
  const [manifestByNode, setManifestByNode] = useState<
    Record<string, ManifestNodeRaw>
  >({});
  // Per-subpackage: should the inline node list be expanded?
  const [expandedNodeList, setExpandedNodeList] = useState<Record<string, boolean>>({});
  // Per-classType: should the individual node preview card be expanded to show
  // its ports + widgets? Default collapsed — the package list already gives a
  // 146-node package an enormous leaf count, so expanding every one of them on
  // click would be excessive.
  const [nodeExpanded, setNodeExpanded] = useState<Record<string, boolean>>({});

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const stillParsing =
      parsing || Object.values(perPkgParsing).some(Boolean);
    if (stillParsing) {
      if (consoleRef.current) consoleRef.current.scrollTop = consoleRef.current.scrollHeight;
    } else if (logs.some((log) => log.level === "error" || log.msg.includes("✗"))) {
      const idx = logs.findIndex((log) => log.level === "error" || log.msg.includes("✗"));
      requestAnimationFrame(() => {
        const console_ = consoleRef.current;
        if (!console_) return;
        const row = console_.querySelectorAll<HTMLDivElement>("[data-log-row]");
        const target = row[idx];
        if (!target) return;
        // Compute scrollTop relative to the panel itself. `target.offsetTop`
        // measures from the nearest *positioned* ancestor — this panel has
        // no `position: relative`, so it falls back to a much higher
        // ancestor (the dialog's fixed wrapper), giving nonsense values.
        // getBoundingClientRect + the panel's own rect + its scrollTop
        // yields the correct in-panel offset.
        const targetTop = target.getBoundingClientRect().top - console_.getBoundingClientRect().top;
        console_.scrollTop = Math.max(0, console_.scrollTop + targetTop - 8);
      });
    }
  }, [logs, parsing, perPkgParsing]);

  // When parsing starts OR finishes, scroll the dialog so the log console
  // is in view — otherwise a tall subpackage list pushes the log below the fold
  // and the user has to manually collapse parents to see it.
  useEffect(() => {
    if (parsing || Object.values(perPkgParsing).some(Boolean)) {
      // Defer one frame so the log block has actually mounted before we scroll
      requestAnimationFrame(() => {
        logsRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
      });
    }
  }, [parsing, perPkgParsing, logs.length]);
  // Also scroll to logs when a single-package parse finishes — at that moment
  // the new report appends and reloadFromServer() repopulates the list.
  useEffect(() => {
    if (report && !parsing && !Object.values(perPkgParsing).some(Boolean)) {
      requestAnimationFrame(() => {
        logsRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
      });
    }
  }, [report]);

  /** Fetch settings from the server and apply them to local state.
   *  No synchronous setState before the first await, so this can be called
   *  straight from an effect (React 19 rule: no set-state-in-effect).
   *  Callers that want a spinner reset should use `reloadFromServer`. */
  const fetchSettings = useCallback(async () => {
    try {
      const res = await fetch("/api/custom-nodes");
      const ct = res.headers.get("content-type") || "";
      const isStream = ct.includes("ndjson");

      if (!isStream) {
        // Warm cache path: server returned a single JSON blob.
        const data: SettingsResp = await res.json();
        const paths = data.settings.paths || [];
        setPathsText(paths.join("\n"));
        setSavedPaths(paths);
        // 2026-08-11 R38: previously the warm-cache branch ONLY populated
        // `pathsText`/`savedPaths` and ignored `data.settings.localWorkflowPaths`
        // entirely.  Combined with the "未配置" status badge being keyed off
        // `!localSavedAt` (which is null on a fresh mount), the dialog would
        // show "未配置 — 在上面输入至少一个目录" even when .env already had
        // LOCAL_WORKFLOWS_PATH set from a previous session.  Load both fields
        // here so the textarea shows the actual saved value.
        const localPaths = data.settings.localWorkflowPaths || [];
        setLocalPathsText(localPaths.join("\n"));
        setSavedLocalPaths(localPaths);
        setSummary(data.summary);
        setReport(data.lastReport);
        setDiscoveredByParent(data.discoveredByParent || {});
        setByPath(data.byPath || {});
        setExpandedParents((prev) => {
          const out = { ...prev };
          for (const p of paths) if (!(p in out)) out[p] = true;
          return out;
        });
        return;
      }

      // Cold path: read ndjson stream of progress events.
      const reader = res.body?.getReader();
      if (!reader) throw new Error("服务器未返回流式响应");
      const decoder = new TextDecoder();
      let buf = "";
      let summary: any = null;
      let lastReport: any = null;
      let byPath: any = {};
      // 2026-08-11 R38: the `summary` event carries the local-workflow
      // path list under `settings.localWorkflowPaths`.  We collect it
      // here and push to React state when the stream finishes.
      let localWorkflowPathsArr: string[] = [];
      const discoveredByParent: Record<string, any[]> = {};
      const paths: string[] = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl);
          buf = buf.slice(nl + 1);
          if (!line.trim()) continue;
          let ev: any;
          try { ev = JSON.parse(line); } catch { continue; }
          if (ev.type === "discover_start") {
            paths.push(...(ev.parents || []));
            setProgress({ phase: "queue", done: 0, total: 0, discovered: 0, parent: "", msg: "准备扫描…" });
          } else if (ev.type === "progress") {
            setProgress((progress) => {
              // Pick up whatever the latest event told us. `total`/`done`/
              // `discovered` are only updated when the event actually carries
              // them (the parser emits them on every meaningful tick), so
              // events that only carry `msg` don't reset the counters.
              const next = { ...progress, parent: ev.parent || progress.parent };
              if (ev.phase === "queue") next.phase = "queue";
              if (ev.phase === "scan") next.phase = "scan";
              if (ev.phase === "hash") next.phase = "hash";
              if (ev.msg) next.msg = ev.msg;
              if (typeof ev.discovered === "number") next.discovered = ev.discovered;
              if (typeof ev.total === "number") next.total = ev.total;
              if (typeof ev.done === "number") next.done = ev.done;
              return next;
            });
          } else if (ev.type === "discover_done") {
            discoveredByParent[ev.parent] = ev.packages || [];
            // Don't touch the package counter here — the parser already
            // emitted its own final tick (✔ ... done=M|total=M) before the
            // JSON line. We just refresh the parent shown in the header.
            setProgress((progress) => ({ ...progress, parent: ev.parent, msg: `✔ ${ev.parent}` }));
          } else if (ev.type === "summary") {
            summary = ev.summary;
            lastReport = ev.lastReport;
            byPath = ev.byPath || {};
            // 2026-08-11 R38: same fix as the warm-cache branch — the
            // `summary` event already carries `settings.localWorkflowPaths`
            // (server route.ts:414) but the client never picked it up,
            // so the dialog always rendered an empty textarea and the
            // "未配置" badge even when the .env had saved paths.
            const lwp = ev.settings?.localWorkflowPaths || [];
            localWorkflowPathsArr = lwp;
          } else if (ev.type === "error") {
            setSaveErr("扫描失败：" + (ev.message || "未知错误"));
          }
        }
      }

      setPathsText(paths.join("\n"));
      setSavedPaths(paths);
      // 2026-08-11 R38: sync the local-workflow state with what the stream
      // emitted, mirroring the warm-cache branch above.
      setLocalPathsText(localWorkflowPathsArr.join("\n"));
      setSavedLocalPaths(localWorkflowPathsArr);
      setSummary(summary);
      setReport(lastReport);
      setDiscoveredByParent(discoveredByParent);
      setByPath(byPath);
      setExpandedParents((prev) => {
        const out = { ...prev };
        for (const p of paths) if (!(p in out)) out[p] = true;
        return out;
      });
    } catch (e) {
      setSaveErr("读取配置失败：" + String(e));
    } finally {
      setLoading(false);
      // Keep the final progress line visible for a beat so the user sees
      // "完成" before it disappears; cleared on next reset.
      setTimeout(() => setProgress({ phase: "", done: 0, total: 0, discovered: 0, parent: "", msg: "" }), 800);
    }
  }, []);

  /** Reset the spinner/status and then fetch. Only call from event handlers
   *  or async callbacks (never synchronously inside an effect). */
  const reloadFromServer = useCallback(() => {
    setLoading(true);
    setSaveErr(null);
    setProgress({ phase: "", done: 0, total: 0, discovered: 0, parent: "", msg: "" });
    return fetchSettings();
  }, [fetchSettings]);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => void fetchSettings(), 0);
    return () => clearTimeout(t);
  }, [open, fetchSettings]);

  // Fetch the raw manifest on open + after every parse (the `report` state
  // updates whenever a parse-finished event lands). Cheap because the file
  // is already on disk; the response is small JSON.
  const fetchManifest = useCallback(async () => {
    const m = await getCustomNodesManifest();
    if (m) setManifestByNode(m.nodes || {});
  }, []);
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => void fetchManifest(), 0);
    return () => clearTimeout(t);
  }, [open, fetchManifest]);
  useEffect(() => {
    if (!report) return;
    const t = setTimeout(() => void fetchManifest(), 0);
    return () => clearTimeout(t);
  }, [report, fetchManifest]);

  // Debounced auto-save: edits → 600ms idle → PUT to .env
  useEffect(() => {
    const live = splitPaths(pathsText);
    if (open && !eqArr(live, savedPaths)) {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(async () => {
        setSaving(true);
        setSaveErr(null);
        try {
          const res = await fetch("/api/custom-nodes", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "saveSettings", customNodesPaths: live }),
          });
          const d = await res.json();
          if (!res.ok || !d.ok) throw new Error(d.error || "保存失败");
          setSavedPaths(d.paths);
          setSavedAt(nowTimeStr());
          await reloadFromServer(); // re-discover subpackages under new paths
        } catch (e) {
          setSaveErr("自动保存失败：" + String(e));
        } finally {
          setSaving(false);
        }
      }, 600);
    }
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [pathsText, savedPaths, open, reloadFromServer]);

  // 2026-08-10 R8: independent auto-save for the LOCAL_WORKFLOWS_PATH field.
  // Same debounce pattern as the node-paths effect; one effect per setting
  // so the save/error chips don't conflate.
  const localSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const live = splitPaths(localPathsText);
    if (open && !eqArr(live, savedLocalPaths)) {
      if (localSaveTimerRef.current) clearTimeout(localSaveTimerRef.current);
      localSaveTimerRef.current = setTimeout(async () => {
        setLocalSaving(true);
        setLocalSaveErr(null);
        try {
          const res = await fetch("/api/custom-nodes", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "saveSettings",
              localWorkflowPaths: live,
            }),
          });
          const d = await res.json();
          if (!res.ok || !d.ok) throw new Error(d.error || "保存失败");
          setSavedLocalPaths(d.localWorkflowPaths ?? live);
          setLocalSavedAt(nowTimeStr());
          // 2026-08-13: Notify any mounted list (e.g. WorkflowLibrary) to
          // re-fetch /api/workflows so the newly-configured root's
          // local-pending entries surface immediately. The dialog renders
          // its own live preview below, but other panels downstream need a
          // nudge. Event name is namespaced to avoid collisions.
          if (typeof window !== "undefined") {
            window.dispatchEvent(new CustomEvent("comfyapp:local-workflows-path-changed", {
              detail: { paths: d.localWorkflowPaths ?? live },
            }));
          }
          // No `reloadFromServer` here — the workflows list endpoint
          // owns the local-pending preview, not this dialog.
        } catch (e) {
          setLocalSaveErr("自动保存失败：" + String(e));
        } finally {
          setLocalSaving(false);
        }
      }, 600);
    }
    return () => {
      if (localSaveTimerRef.current) clearTimeout(localSaveTimerRef.current);
    };
  }, [localPathsText, savedLocalPaths, open]);

  async function readNdjson(res: Response, onDone: (report: any, ok: boolean) => void) {
    if (!res.body) {
      onDone(null, false);
      setError_("服务器未返回流式日志");
      return;
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        if (!line.trim()) continue;
        try {
          const obj = JSON.parse(line);
          if (obj.type === "log") {
            setLogs((prev) => [...prev, { level: obj.level || "info", msg: obj.msg }]);
          } else if (obj.type === "done") {
            onDone(obj.report, !!obj.ok);
          }
        } catch {
          // ignore non-JSON
        }
      }
    }
  }

  function setError_(msg: string | null) {
    setSaveErr(msg);
  }

  async function onParseAll() {
    if (savedPaths.length === 0) {
      setError_("请先在上面的输入框填写至少一个目录");
      return;
    }
    setParsing(true);
    setError_(null);
    setReport(null);
    setLogs([]);
    try {
      const res = await fetch("/api/custom-nodes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "parse" }),
      });
      await readNdjson(res, async (r, ok) => {
        if (ok && r) {
          setReport(r as ParseReport);
          await refreshCustomNodes();
        }
        await reloadFromServer();
      });
    } catch (e) {
      setError_("解析失败：" + String(e));
    } finally {
      setParsing(false);
    }
  }

  async function onParseSingle(pkgPath: string) {
    setPerPkgParsing((parsing) => ({ ...parsing, [pkgPath]: true }));
    setError_(null);
    setLogs([]);
    try {
      const res = await fetch("/api/custom-nodes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "parse", packages: [pkgPath] }),
      });
      await readNdjson(res, async (r, ok) => {
        if (ok && r) {
          setReport(r as ParseReport);
          await refreshCustomNodes();
        }
        await reloadFromServer();
      });
    } catch (e) {
      setError_("解析失败：" + String(e));
    } finally {
      setPerPkgParsing((parsing) => {
        const np = { ...parsing };
        delete np[pkgPath];
        return np;
      });
    }
  }

  /** Re-parse every subpackage under a single configured parent directory in one shot.
   *  Reuses the same subset-parser path, just with N absolute paths at once.
   *  Empty / missing dirs are tolerated by the parser itself (logged + skipped). */
  async function onParseAllParent(parent: string) {
    const subs = discoveredByParent[parent] || [];
    const targets = subs.map((sub) => sub.path).filter(Boolean);
    if (targets.length === 0) {
      setError_("该目录下没有可解析的子包");
      return;
    }
    setParsing(true);
    setError_(null);
    setLogs([]);
    try {
      const res = await fetch("/api/custom-nodes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "parse", packages: targets }),
      });
      await readNdjson(res, async (r, ok) => {
        if (ok && r) {
          setReport(r as ParseReport);
          await refreshCustomNodes();
        }
        await reloadFromServer();
      });
    } catch (e) {
      setError_("解析失败：" + String(e));
    } finally {
      setParsing(false);
    }
  }

  // Flat list of discovered subpackages across all configured parents. A single
  // top-level package (e.g. Anima-Artist-Mixer) shows once even if the user typed
  // the parent custom_nodes path; we don't render the parent card itself.
  // Group discovered subpackages by their parent directory so the user can
  // collapse / expand each source directory independently. Each child row
  // carries its own `state` (loaded / outdated / unimported / error / missing)
  // by joining against the manifest's byPath map.
  const parentBlocks = useMemo(() => {
    return savedPaths.map((parent) => {
      const subs = discoveredByParent[parent] || [];
      const enriched = subs.map((sub) => {
        const saved = byPath[pathKey(sub.path)];
        return { sub, saved, state: deriveRowState(sub, saved) };
      });
      const cnt = { loaded: 0, outdated: 0, unimported: 0, error: 0, missing: 0, empty: 0 };
      for (const e of enriched) cnt[e.state.kind] += 1;
      return { parent, subs: enriched, cnt, total: enriched.length };
    });
  }, [savedPaths, discoveredByParent, byPath]);

  const totalAcrossParents = useMemo(() => {
    return parentBlocks.reduce(
      (acc, b) => ({
        loaded: acc.loaded + b.cnt.loaded,
        outdated: acc.outdated + b.cnt.outdated,
        unimported: acc.unimported + b.cnt.unimported,
        total: acc.total + b.total,
      }),
      { loaded: 0, outdated: 0, unimported: 0, total: 0 },
    );
  }, [parentBlocks]);

  return (
    <>
      <div>
        {/* 2026-08-10 R8: removed the standalone "扩展节点（自定义 ComfyUI 节点包）"
            caption — the dialog title (line 924/新增) already names both
            sections, and the workspace button sits inside the existing
            "工作流库" header. */}
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-3 py-2.5 text-sm font-semibold text-white shadow-sm transition-opacity hover:opacity-90"
          title="配置自定义节点目录与本地工作流目录（服务端只读、绝不修改这些目录里的任何文件）"
        >
          <span>{"\u{1F4E6}"}</span>
          <span>自定义节点 / 本地工作流</span>
        </button>
      </div>

      {open && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4"
          onClick={() => setOpen(false)}
        >
          <div
            ref={dialogRef}
            className="w-full max-w-3xl rounded-2xl border border-border bg-surface p-5"
            onClick={(event) => event.stopPropagation()}
            style={{ maxHeight: "92vh", overflowY: "auto" }}
          >
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-base font-semibold text-ink">自定义节点 & 本地工作流</h3>
              <button
                onClick={() => setOpen(false)}
                className="rounded-lg px-2 py-1 text-muted hover:bg-subtle hover:text-ink"
              >
                关闭
              </button>
            </div>

            {/* ─────────────── Tab switcher (2026-08-10 R10) ───────────────
                Two pages: "本地工作流" (path input only) vs "自定义节点"
                (parse, manifests, logs). Bottom indicator in the project
                aurora gradient (#A855F7 → #6366F1) matches globals.css.
                Each tab carries a small status chip so the user can see
                which side is configured without switching tabs. */}
            <div
              role="tablist"
              aria-label="配置区域"
              className="mb-4 flex items-center gap-1 border-b border-border"
            >
              <button
                type="button"
                role="tab"
                aria-selected={tab === "workflows"}
                onClick={() => setTab("workflows")}
                className={
                  "relative flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors " +
                  (tab === "workflows" ? "text-ink" : "text-muted hover:text-ink")
                }
              >
                <span aria-hidden>📁</span>
                <span>本地工作流</span>
                {savedLocalPaths.length > 0 && (
                  <span className="rounded-full bg-white/[0.06] px-2 py-0.5 font-mono text-[10px] text-muted">
                    已配 {savedLocalPaths.length}
                  </span>
                )}
                {tab === "workflows" && (
                  <span
                    aria-hidden
                    className="absolute -bottom-px left-0 right-0 h-0.5 rounded-t"
                    style={{ background: "linear-gradient(90deg,#A855F7,#6366F1)" }}
                  />
                )}
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={tab === "nodes"}
                onClick={() => setTab("nodes")}
                className={
                  "relative flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors " +
                  (tab === "nodes" ? "text-ink" : "text-muted hover:text-ink")
                }
              >
                <span aria-hidden>{"\u{1F9E9}"}</span>
                <span>自定义节点</span>
                {totalAcrossParents.total > 0 && (
                  <span className="rounded-full bg-white/[0.06] px-2 py-0.5 font-mono text-[10px] text-muted">
                    {totalAcrossParents.loaded}/{totalAcrossParents.total}
                  </span>
                )}
                {!totalAcrossParents.total && savedPaths.length > 0 && (
                  <span className="rounded-full bg-white/[0.06] px-2 py-0.5 font-mono text-[10px] text-muted">
                    扫描中…
                  </span>
                )}
                {tab === "nodes" && (
                  <span
                    aria-hidden
                    className="absolute -bottom-px left-0 right-0 h-0.5 rounded-t"
                    style={{ background: "linear-gradient(90deg,#A855F7,#6366F1)" }}
                  />
                )}
              </button>
            </div>

            {tab === "workflows" && (
              <>
                {/* ===== 1) 本地工作流目录 (LOCAL_WORKFLOWS_PATH) — 2026-08-10 R8 =====
                    Read-only scanner — server only reads from these directories and NEVER
                    writes / appends / renames anything inside.  After auto-save,
                    the actual scanning happens lazily when the Workflow Library
                    page is opened (see GET /api/workflows; results render as
                    "⤓ 未载入" cards in 本地工作流 tab). */}
            <section className="mb-4 rounded-xl border border-border bg-bg p-4">
              <div className="mb-2 flex items-center justify-between">
                <label className="block text-sm font-medium text-ink">
                  本地工作流目录（LOCAL_WORKFLOWS_PATH）
                </label>
                <span
                  className="rounded-full px-1.5 py-0.5 text-[10px] font-medium"
                  style={{ background: "rgba(56,189,248,0.18)", color: "#7DD3FC" }}
                  title="服务端只读取、绝不修改这些目录里的任何文件"
                >
                  🔒 只读
                </span>
              </div>
              <p className="mb-2 text-xs text-muted">
                每行一个目录（也可英文逗号分隔）。支持绝对路径，或相对（项目根）路径。
                服务端扫描时会列出其下的 <code className="font-mono">.json</code> / <code className="font-mono">.workflow</code> 文件，
                尚未导入到数据库的会显示在工作流库的「本地工作流」分组里，标题为「⤓ 未载入」，
                点击「载入」才会落库并自动跟踪文件变更。
                <span className="ml-1 text-amber-300/80">目录内容不会被修改。</span>
              </p>
              <textarea
                value={localPathsText}
                onChange={(event) => setLocalPathsText(event.target.value)}
                rows={Math.max(2, Math.min(savedLocalPaths.length || 2, 6))}
                placeholder={
                  "示例 ·  C:\\Users\\me\\AppData\\Local\\Programs\\ComfyUI\\resources\\app\\workflows\n" +
                  "示例 ·  /home/me/ComfyUI/user/default/workflows"
                }
                /* 2026-08-12 R71-2: placeholder 之前用 text-gray-500，看起来太
                 * 像已填的内容，用户看到示例路径就误以为「已经配置好了」。加
                 * italic + 更浅的 gray-600/60，并把前缀改成「示例 ·  」，与
                 * 真实 text-ink 在视觉上彻底分开。*/
                className="mb-2 w-full resize-none rounded-lg border border-border bg-surface p-3 font-mono text-xs text-ink outline-none placeholder:italic placeholder:text-gray-600/60 focus:border-primary"
              />
              {/* 2026-08-12 R71-2: textarea 真正为空且没有已保存路径时，加一行
               * 小灰提示明确告诉用户「上面灰字只是示例，需要你手动输入」。*/}
              {localPathsText.trim() === "" && savedLocalPaths.length === 0 && !localSaving && (
                <p className="mb-2 text-[11px] italic text-gray-500/80">
                  ⓘ 上面 textarea 里灰色斜体只是示例路径，请手动输入你本地 ComfyUI 的工作流目录。
                </p>
              )}
              {savedLocalPaths.length > 0 && (
                <ul className="mb-2 space-y-1">
                  {savedLocalPaths.map((path, i) => (
                    <li
                      key={`${path}-${i}`}
                      className="flex items-center gap-2 truncate font-mono text-[11px] text-muted"
                      title={path}
                    >
                      <span className="inline-block h-1.5 w-1.5 rounded-full bg-cyan-400" />
                      <span className="truncate">{path}</span>
                    </li>
                  ))}
                </ul>
              )}
              <div className="flex items-center justify-between text-xs text-muted">
                <div className="flex flex-wrap items-center gap-2">
                  {localSaving && (
                    <span className="flex items-center gap-1.5 text-primary">
                      <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-primary" />
                      自动保存中…
                    </span>
                  )}
                  {!localSaving && localSaveErr && (
                    <span className="text-red-400">⚠ {localSaveErr}</span>
                  )}
                  {!localSaving && !localSaveErr && localSavedAt && savedLocalPaths.length > 0 && (
                    <span className="text-emerald-400">✓ 已自动保存 {localSavedAt}</span>
                  )}
                  {/* 2026-08-11 R38: prior condition was `!localSavedAt`
                      which fired even when .env already had saved paths
                      (because `localSavedAt` is only set on this-session
                      auto-save).  The new condition keys off the actually-
                      saved value: if we have any paths, we're "configured";
                      the timestamp is a separate, optional nicety. */}
                  {!localSaving && !localSaveErr && !localSavedAt && savedLocalPaths.length > 0 && (
                    <span className="text-emerald-400">✓ 已配置（来自 .env）</span>
                  )}
                  {!localSaving && !localSaveErr && loading && (
                    <span className="flex items-center gap-1.5 text-muted">
                      <span className="inline-block h-2 w-2 animate-spin rounded-full border border-muted border-t-transparent" />
                      加载中…
                    </span>
                  )}
                  {!localSaving && !localSaveErr && !loading && savedLocalPaths.length === 0 && (
                    /* 2026-08-12 R71-2: 这条消息之前是「在上面输入至少一个目录」，
                     * 但用户看到灰色 placeholder（看起来像内容）就误以为已配置。
                     * 现在 placeholder 已经加了 italic + 「示例 ·  」前缀并伴随
                     * ⓘ 提示行，这条消息只要简短地说「尚未配置」即可。*/
                    <span>尚未配置 — 请在上面的 textarea 里输入你的本地工作流目录</span>
                  )}
                </div>
              </div>
            </section>
              </>
            )}

            {tab === "nodes" && (
              <>
            {/* ===== 2) 自定义节点目录（CUSTOM_NODES_PATH）— original section ===== */}
            <section className="mb-4 rounded-xl border border-border bg-bg p-4">
              <div className="mb-2 flex items-center justify-between">
                <label className="block text-sm font-medium text-ink">
                  自定义节点目录（CUSTOM_NODES_PATH）
                </label>
                <span
                  className="rounded-full px-1.5 py-0.5 text-[10px] font-medium"
                  style={{ background: "rgba(16,185,129,0.18)", color: "#10B981" }}
                  title="解析器只读取这些目录里的 .py、绝不修改其中任何文件"
                >
                  🔒 只读
                </span>
              </div>
              <p className="mb-2 text-xs text-muted">
                每行一个目录（也可英文逗号分隔）。支持相对（项目根）或绝对路径。解析器只读取这些目录、绝不修改其中任何文件。
              </p>
              <textarea
                value={pathsText}
                onChange={(event) => setPathsText(event.target.value)}
                rows={Math.max(2, Math.min(savedPaths.length || 2, 6))}
                placeholder={"scripts/fixtures/sample_custom_nodes\nD:/ComfyUI/custom_nodes"}
                className="mb-2 w-full resize-none rounded-lg border border-border bg-surface p-3 font-mono text-xs text-ink outline-none placeholder:text-gray-500 focus:border-primary"
              />
              <div className="mb-4 flex items-center justify-between text-xs">
                <div className="flex flex-wrap items-center gap-2 text-muted">
                  {saving && (
                    <span className="flex items-center gap-1.5 text-primary">
                      <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-primary" />
                      自动保存中…
                    </span>
                  )}
                  {!saving && saveErr && <span className="text-red-400">⚠ {saveErr}</span>}
                  {/* Directory overview chips — show totals + outdated count when any subpackage is detected. */}
                  {totalAcrossParents.total > 0 && (
                    <>
                      <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-ink">
                        总览 {totalAcrossParents.total} 个子包
                      </span>
                      {totalAcrossParents.loaded > 0 && (
                        <span
                          className="rounded-full px-2 py-0.5 font-medium"
                          style={{ background: "rgba(16,185,129,0.18)", color: "#10B981" }}
                        >
                          ✓ 已加载 {totalAcrossParents.loaded}
                        </span>
                      )}
                      {totalAcrossParents.outdated > 0 && (
                        <span
                          className="rounded-full px-2 py-0.5 font-medium"
                          style={{ background: "rgba(245,158,11,0.22)", color: "#F59E0B" }}
                        >
                          ↻ 有更新 {totalAcrossParents.outdated}
                        </span>
                      )}
                    </>
                  )}
                  {!saving && !saveErr && loading && (
                    <span className="flex items-center gap-1.5 text-muted">
                      <span className="inline-block h-2 w-2 animate-spin rounded-full border border-muted border-t-transparent" />
                      加载中…
                    </span>
                  )}
                  {!saving && !saveErr && !loading && savedAt && totalAcrossParents.total === 0 && (
                    <span className="text-emerald-400">✓ 已自动保存 {savedAt}</span>
                  )}
                  {!saving && !saveErr && !loading && !savedAt && totalAcrossParents.total === 0 && (
                    <span>未配置 — 上面输入至少一个目录</span>
                  )}
                </div>
                <button
                  onClick={onParseAll}
                  disabled={parsing || savedPaths.length === 0}
                  className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
                >
                  {parsing ? "解析全部中…" : "▶ 解析全部"}
                </button>
              </div>
            </section>

            {/* Live manifest summary */}
            {summary && (
              <div className="mb-4 rounded-lg border border-border bg-bg px-3 py-2 text-xs text-muted">
                当前清单：共 <b className="text-ink">{summary.totalNodes}</b> 个节点类型
                {summary.generatedAt ? ` · 生成于 ${summary.generatedAt}` : ""}
                {summary.missingPaths?.length ? ` · ⚠️ ${summary.missingPaths.length} 个目录未找到` : ""}
              </div>
            )}
            {loading && !summary && (
              <div className="mb-4 rounded-lg border border-dashed border-border bg-bg/50 px-3 py-3 text-xs text-muted">
                {/* Top line: current phase, with package counter (the user's
                    primary interest). The .py file count is gone — they
                    explicitly said it isn't useful. */}
                <div className="flex items-center gap-2">
                  <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-primary" />
                  {progress.phase === "hash" && progress.total > 0 ? (
                    <span className="text-ink">
                      🔎 正在处理 <span className="font-mono">{progress.done}/{progress.total}</span> 个节点包
                      {progress.parent && (
                        <span className="ml-2 truncate font-mono text-[11px] text-muted" title={progress.parent}>
                          · {progress.parent.split(/[\\/]/).slice(-2).join("/")}
                        </span>
                      )}
                    </span>
                  ) : progress.phase === "scan" && progress.discovered > 0 ? (
                    <span className="text-ink">
                      📦 已发现 <span className="font-mono">{progress.discovered}</span> 个节点包
                      <span className="ml-2 text-muted text-[11px]">（总数待定，正在扫描…）</span>
                    </span>
                  ) : (
                    <span>首次扫描目录中的节点包…</span>
                  )}
                </div>
                {/* Bar: indeterminate (CSS stripes) during scan; determined
                    K/M during hash. `progress.total > 0` only flips true at
                    the end of the file walk when the parser announces M, so
                    the bar cleanly transitions scan→hash. */}
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10">
                  {progress.phase === "hash" && progress.total > 0 ? (
                    <div
                      className="h-full bg-primary transition-all duration-300 ease-out"
                      style={{
                        width: `${Math.min(100, (progress.done / progress.total) * 100)}%`,
                      }}
                    />
                  ) : (
                    // Indeterminate progress: animated stripes moving left→right
                    <div
                      className="h-full w-1/3 bg-primary"
                      style={{
                        animation: "progressStripe 1.4s ease-in-out infinite",
                      }}
                    />
                  )}
                </div>
                {progress.msg && (
                  <div
                    className="mt-1.5 truncate font-mono text-[10px] text-muted"
                    title={progress.msg}
                  >
                    {progress.msg}
                  </div>
                )}
              </div>
            )}

            {/* Group-by-parent collapsible view. Each top-level dir is its own
                block; subpackages inside a block can be hidden / shown via the
                chevron so the user can focus on one source tree at a time. */}
            <div className="mb-4">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-sm font-medium text-ink">
                  可导入的节点包
                  {totalAcrossParents.outdated > 0 && (
                    <span className="ml-2 rounded-full px-2 py-0.5 text-[10px] font-medium" style={{ background: "rgba(245,158,11,0.18)", color: "#F59E0B" }}>
                      ↻ {totalAcrossParents.outdated} 个有更新
                    </span>
                  )}
                </span>
                <span className="text-xs text-muted">
                  共 {totalAcrossParents.total} 个子包
                  {savedPaths.length > 0
                    ? ` · 已加载 ${totalAcrossParents.loaded + totalAcrossParents.outdated}/${totalAcrossParents.total}`
                    : ""}
                </span>
              </div>
              {savedPaths.length === 0 && !loading && (
                <div className="rounded-lg border border-dashed border-border bg-bg/50 p-4 text-center text-xs text-muted">
                  上面输入至少一个目录后，会自动发现其下的节点包。
                </div>
              )}
              <div className="space-y-2">
                {parentBlocks.map(({ parent, subs, cnt, total }) => {
                  const isOpen = !!expandedParents[parent];
                  const parentParsed = total > 0 && cnt.unimported + cnt.missing + cnt.empty === 0;
                  return (
                    <div key={parent} className="rounded-xl border border-border bg-bg">
                      {/* Parent header — clickable to toggle.
                          IMPORTANT: must NOT be a <button>, because the row contains a
                          nested action <button> ("解析本目录"). Nested <button> in HTML
                          is invalid and triggers React hydration errors. We use a div
                          with role/keyboard handlers so a11y is preserved. */}
                      <div
                        role="button"
                        tabIndex={0}
                        onClick={() => setExpandedParents((parents) => ({ ...parents, [parent]: !parents[parent] }))}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            setExpandedParents((parents) => ({ ...parents, [parent]: !parents[parent] }));
                          }
                        }}
                        className="flex w-full cursor-pointer items-center justify-between gap-2 rounded-xl px-3 py-2.5 text-left hover:bg-subtle"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-xs text-muted">
                              {isOpen ? "▾" : "▸"}
                            </span>
                            <span className="font-medium text-ink">📁</span>
                            <span
                              className="truncate font-mono text-[12px] text-ink"
                              title={parent}
                            >
                              {parent}
                            </span>
                          </div>
                          <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[10px] text-muted">
                            <span>{total} 个子包</span>
                            {cnt.loaded > 0 && (
                              <span className="rounded-full px-1.5 py-0.5" style={{ background: "rgba(16,185,129,0.18)", color: "#10B981" }}>
                                ✓ {cnt.loaded}
                              </span>
                            )}
                            {cnt.outdated > 0 && (
                              <span className="rounded-full px-1.5 py-0.5" style={{ background: "rgba(245,158,11,0.20)", color: "#F59E0B" }}>
                                ↻ {cnt.outdated}
                              </span>
                            )}
                            {cnt.unimported > 0 && (
                              <span className="rounded-full px-1.5 py-0.5" style={{ background: "rgba(107,114,128,0.20)", color: "#9CA3AF" }}>
                                {cnt.unimported} 未导入
                              </span>
                            )}
                            {cnt.error > 0 && (
                              <span className="rounded-full px-1.5 py-0.5" style={{ background: "rgba(239,68,68,0.18)", color: "#EF4444" }}>
                                ⚠ {cnt.error}
                              </span>
                            )}
                            {cnt.missing > 0 && (
                              <span className="rounded-full px-1.5 py-0.5" style={{ background: "rgba(245,158,11,0.20)", color: "#F59E0B" }}>
                                ⚠ {cnt.missing} 不存在
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              onParseAllParent(parent);
                            }}
                            disabled={!!parsing || total === 0 || (parentParsed && cnt.outdated === 0)}
                            className="rounded-lg border border-border bg-bg px-3 py-1 text-[11px] font-medium text-ink hover:bg-subtle disabled:cursor-not-allowed disabled:opacity-50"
                            title={parentParsed && cnt.outdated === 0 ? "已加载、无更新" : "重新解析此目录下所有子包"}
                          >
                            {parsing ? "…" : "解析本目录"}
                          </button>
                        </div>
                      </div>

                      {/* Subpackages — only when expanded */}
                      {isOpen && subs.length > 0 && (
                        <div className="border-t border-border bg-surface/50 p-2">
                          <div className="space-y-1.5">
                            {subs.map(({ sub, saved, state }) => {
                              const preset = ROW_STATE_PRESET[state.kind];
                              const toolTip = state.kind === "outdated"
                                ? `上次解析保存的 hash ${state.savedHash.slice(0, 8)}… / 当前磁盘 hash ${state.diskHash.slice(0, 8)}…（节点源文件有改动）`
                                : state.kind === "loaded"
                                ? `内容未变（hash ${state.savedHash.slice(0, 8)}…）`
                                : sub.path;
                              const nodeCount =
                                state.kind === "loaded" || state.kind === "outdated"
                                  ? state.kind === "loaded"
                                    ? state.nodeCount
                                    : state.savedNodeCount
                                  : sub.packageFileCount;
                              // Click-to-expand is only available for packages that
                              // actually have parsed nodes. Unimported / missing /
                              // empty packages don't have anything to show.
                              const nodesAreLoaded =
                                state.kind === "loaded" || state.kind === "outdated";
                              const nodeListOpen = !!expandedNodeList[sub.path];
                              const nodeTypeList = (saved?.nodeTypes ?? []) as string[];
                              return (
                                <div key={sub.path}>
                                  <div
                                    className="flex items-center justify-between gap-2 rounded-lg border bg-bg p-2 pl-3"
                                    style={{ borderColor: preset.fg + "30", background: preset.bg }}
                                    title={toolTip}
                                  >
                                    <div className="min-w-0 flex-1">
                                      <div className="flex items-center gap-2">
                                        <span className="font-medium text-ink">{sub.name}</span>
                                        <span
                                          className={"rounded-full border px-2 py-0.5 text-[10px] font-medium " + preset.chip}
                                          style={{ color: preset.fg }}
                                        >
                                          {state.kind === "loaded" && saved?.parsedAt ? `已加载 ${saved.parsedAt.split("T")[1]?.slice(0, 5) ?? ""}` : preset.label}
                                        </span>
                                      </div>
                                      <div className="truncate font-mono text-[10px] text-muted" title={sub.path}>
                                        {sub.path}
                                      </div>
                                    </div>
                                    <div className="flex shrink-0 items-center gap-3 text-xs text-muted">
                                      {nodesAreLoaded ? (
                                        <div
                                          role="button"
                                          tabIndex={0}
                                          onClick={(event) => {
                                            event.stopPropagation();
                                            setExpandedNodeList((nodeList) => ({
                                              ...nodeList,
                                              [sub.path]: !nodeList[sub.path],
                                            }));
                                          }}
                                          onKeyDown={(event) => {
                                            if (event.key === "Enter" || event.key === " ") {
                                              event.preventDefault();
                                              event.stopPropagation();
                                              setExpandedNodeList((nodeList) => ({
                                                ...nodeList,
                                                [sub.path]: !nodeList[sub.path],
                                              }));
                                            }
                                          }}
                                          className="cursor-pointer rounded-md px-1.5 py-1 text-right transition-colors hover:bg-white/5"
                                          title={
                                            nodeListOpen
                                              ? "收起节点列表"
                                              : `点击查看已加载的 ${nodeCount} 个节点`
                                          }
                                        >
                                          <div className="flex items-center justify-end gap-1">
                                            <span className="font-mono text-sm font-semibold text-ink">
                                              {nodeCount}
                                            </span>
                                            <span className="text-[10px] text-muted">
                                              {nodeListOpen ? "▾" : "▸"}
                                            </span>
                                          </div>
                                          <div className="text-[10px]">节点</div>
                                        </div>
                                      ) : (
                                        <div className="text-right">
                                          <div className="font-mono text-sm font-semibold text-ink">
                                            {nodeCount}
                                          </div>
                                          <div className="text-[10px]">映射文件</div>
                                        </div>
                                      )}
                                      <button
                                        type="button"
                                        onClick={() => onParseSingle(sub.path)}
                                        disabled={
                                          !!perPkgParsing[sub.path] ||
                                          parsing ||
                                          state.kind === "missing" ||
                                          state.kind === "empty"
                                        }
                                        className={"rounded-md px-3 py-1.5 text-xs font-medium " + preset.btn}
                                      >
                                        {perPkgParsing[sub.path] ? "解析中…" : preset.btnLabel}
                                      </button>
                                    </div>
                                  </div>
                                  {/* Expandable ComfyUI-style node previews. Only
                                      rendered when the user clicks the count cell.
                                      Each card is its own collapse/expand target so
                                      a 146-node package stays scannable. */}
                                  {nodesAreLoaded && nodeListOpen && (
                                    <div
                                      className="ml-3 mt-1 space-y-1 border-l-2 border-dashed py-1 pl-3"
                                      style={{ borderColor: preset.fg + "30" }}
                                    >
                                      {nodeTypeList.length === 0 ? (
                                        <div className="text-[10px] italic text-muted">
                                          此包的清单中没有列出节点类型
                                        </div>
                                      ) : (
                                        nodeTypeList.map((ct) => (
                                          <NodePreviewCard
                                            key={ct}
                                            data={manifestByNode[ct]}
                                            fallbackName={ct}
                                            expanded={!!nodeExpanded[ct]}
                                            onToggle={() =>
                                              setNodeExpanded((expanded) => ({
                                                ...expanded,
                                                [ct]: !expanded[ct],
                                              }))
                                            }
                                          />
                                        ))
                                      )}
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}
                      {isOpen && subs.length === 0 && (
                        <div className="border-t border-border bg-surface/50 p-3 text-center text-[11px] text-muted">
                          这个目录下没有发现包含 NODE_CLASS_MAPPINGS 的子包
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Live parse console */}
            <div ref={logsRef} className="mb-4">
              <div className="mb-1 flex items-center justify-between">
                <span className="text-xs font-medium text-muted">解析日志</span>
                {parsing && (
                  <span className="flex items-center gap-1.5 text-xs text-primary">
                    <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-primary" />
                    解析中…
                  </span>
                )}
              </div>
              {logs.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border bg-bg/30 p-3 text-center text-[11px] text-muted">
                  {parsing ? "等待第一条日志…" : "点击「解析全部」或「导入此包」后日志会出现在这里。"}
                </div>
              ) : (
                <div
                  ref={consoleRef}
                  className="h-48 overflow-y-auto rounded-lg border border-border bg-black/70 p-3 font-mono text-[11px] leading-relaxed"
                >
                  {logs.map((l, idx) => (
                    <div
                      key={idx}
                      data-log-row
                      className={l.level === "error" ? "text-red-400" : "text-emerald-300/90"}
                    >
                      {l.msg}
                    </div>
                  ))}
                  {parsing && <div className="text-gray-500">…</div>}
                </div>
              )}
            </div>

            {/* Per-package report cards */}
            {report && (
              <div className="mt-2">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-sm font-medium text-ink">最近解析结果</span>
                  <span className="text-xs text-muted">
                    {(report as any).mode === "subset"
                      ? `增量 +${(report as any).addedNodes ?? 0}`
                      : `${report.pathCount} 个目录 · ${report.totalNodes} 个节点`}
                    {report.errorCount ? ` · ${report.errorCount} 个错误` : ""}
                  </span>
                </div>
                <div className="space-y-2">
                  {(report.packages ?? []).map((pkg, i) => {
                    const st = STATUS_STYLE[pkg.status] || STATUS_STYLE.ok;
                    return (
                      <div key={i} className="rounded-xl border border-border bg-bg p-3">
                        <div className="flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="font-medium text-ink">{pkg.name}</span>
                              <span
                                className="rounded-full px-2 py-0.5 text-[11px] font-medium"
                                style={{ background: st!.bg, color: st!.fg }}
                              >
                                {st!.label}
                              </span>
                            </div>
                            <div className="truncate font-mono text-[11px] text-muted" title={pkg.path}>
                              {pkg.path}
                            </div>
                          </div>
                          <div className="shrink-0 text-right">
                            <div className="text-lg font-semibold" style={{ color: st!.fg }}>
                              {pkg.nodeCount}
                            </div>
                            <div className="text-[11px] text-muted">节点类型</div>
                          </div>
                        </div>
                        {pkg.nodeTypes?.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-1">
                            {pkg.nodeTypes.slice(0, 24).map((ct) => (
                              <span
                                key={ct}
                                className="rounded-md bg-white/[0.04] px-1.5 py-0.5 font-mono text-[11px] text-muted"
                              >
                                {ct}
                              </span>
                            ))}
                            {pkg.nodeTypes.length > 24 && (
                              <span className="rounded-md bg-white/[0.04] px-1.5 py-0.5 font-mono text-[11px] text-muted">
                                +{pkg.nodeTypes.length - 24}
                              </span>
                            )}
                          </div>
                        )}
                        {pkg.errors?.length > 0 && (
                          <div className="mt-2 space-y-1">
                            {pkg.errors.map((er, j) => (
                              <div key={j} className="font-mono text-[11px] text-red-400">
                                ⚠ {er.file}: {er.error}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </>
        )}
          </div>
        </div>
      )}
    </>
  );
}
