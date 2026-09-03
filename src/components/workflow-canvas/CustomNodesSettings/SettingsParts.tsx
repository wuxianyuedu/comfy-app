/* Small presentational building blocks for the CustomNodesSettings dialog.
 * PortRow / WidgetValueChip moved verbatim from the original single-file
 * CustomNodesSettings.tsx; ManifestSummary / ParseProgressBanner / ParseConsole
 * / ReportCards are the low-entanglement JSX sections lifted out of the main
 * component's render (state is passed in explicitly via props). */

import type { RefObject } from "react";
import { STATUS_STYLE } from "./constants";
import type { ParseProgress, ParseReport, SettingsResp } from "./types";

/** One row in the typed-ports zone — small coloured dot + uppercase type badge
 *  + port name. ComfyUI's actual nodes put the dot at the canvas edge and the
 *  name + type chip on the interior; we mirror that geometry so each port row
 *  reads at a glance which side of the node it belongs to. */
export function PortRow({
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

/** 把 widget 值安全转成展示文本：对象走 JSON，null/undefined 给空串，其余 String。 */
function widgetValueToText(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "object") return JSON.stringify(v);
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "bigint") return v.toString();
  if (typeof v === "symbol") return v.toString();
  if (typeof v === "function") return v.toString();
  return "";
}

export function WidgetValueChip({
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
          color: on ? "var(--color-success-strong)" : "#EF4444",
          fontFamily: "var(--font-mono)",
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
          fontFamily: "var(--font-mono)",
        }}
        title={widgetValueToText(value)}
      >
        {value == null ? "—" : widgetValueToText(value)}
      </span>
    );
  }
  if (widget === "number") {
    return (
      <span
        className="max-w-[100px] truncate rounded px-1.5 py-px text-[10px] font-semibold"
        style={{
          background: "rgba(245,158,11,0.18)",
          color: "var(--color-warning)",
          fontFamily: "var(--font-mono)",
        }}
        title={widgetValueToText(value)}
      >
        {value == null ? "—" : widgetValueToText(value)}
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
        fontFamily: "var(--font-mono)",
      }}
      title={widgetValueToText(value)}
    >
      {value == null ? "—" : widgetValueToText(value)}
    </span>
  );
}

/** "当前清单" one-line manifest summary — lifted verbatim from the main
 *  component's "nodes" tab render. */
export function ManifestSummary({
  summary,
}: {
  summary: NonNullable<SettingsResp["summary"]>;
}) {
  return (
    <div className="mb-4 rounded-lg border border-border bg-bg px-3 py-2 text-xs text-muted-foreground">
      当前清单：共 <b className="text-ink">{summary.totalNodes}</b> 个节点类型
      {summary.generatedAt ? ` · 生成于 ${summary.generatedAt}` : ""}
      {summary.missingPaths?.length ? ` · ⚠️ ${summary.missingPaths.length} 个目录未找到` : ""}
    </div>
  );
}

/** Two-phase parse progress banner (scan → hash) — lifted verbatim from the
 *  main component's "nodes" tab render. Rendered only while `loading` and no
 *  summary exists yet (the caller keeps that condition). */
export function ParseProgressBanner({
  progress,
}: {
  progress: ParseProgress;
}) {
  return (
    <div className="mb-4 rounded-lg border border-dashed border-border bg-bg/50 px-3 py-3 text-xs text-muted-foreground">
      {/* Top line: current phase, with package counter (the user's
          primary interest). The .py file count is gone — they
          explicitly said it isn't useful. */}
      <div className="flex items-center gap-2">
        <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-primary" />
        {progress.phase === "hash" && progress.total > 0 ? (
          <span className="text-ink">
            🔎 正在处理 <span className="font-mono">{progress.done}/{progress.total}</span> 个节点包
            {progress.parent && (
              <span className="ml-2 truncate font-mono text-[11px] text-muted-foreground" title={progress.parent}>
                · {progress.parent.split(/[\\/]/).slice(-2).join("/")}
              </span>
            )}
          </span>
        ) : progress.phase === "scan" && progress.discovered > 0 ? (
          <span className="text-ink">
            📦 已发现 <span className="font-mono">{progress.discovered}</span> 个节点包
            <span className="ml-2 text-muted-foreground text-[11px]">（总数待定，正在扫描…）</span>
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
          className="mt-1.5 truncate font-mono text-[10px] text-muted-foreground"
          title={progress.msg}
        >
          {progress.msg}
        </div>
      )}
    </div>
  );
}

/** Live parse console (log list) — lifted verbatim from the main component's
 *  "nodes" tab render. The two scroll refs belong to the main component's
 *  auto-scroll effects and are passed through unchanged. */
export function ParseConsole({
  logs,
  parsing,
  logsRef,
  consoleRef,
}: {
  logs: { level: string; msg: string }[];
  parsing: boolean;
  logsRef: RefObject<HTMLDivElement | null>;
  consoleRef: RefObject<HTMLDivElement | null>;
}) {
  return (
    <div ref={logsRef} className="mb-4">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">解析日志</span>
        {parsing && (
          <span className="flex items-center gap-1.5 text-xs text-primary">
            <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-primary" />
            解析中…
          </span>
        )}
      </div>
      {logs.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-bg/30 p-3 text-center text-[11px] text-muted-foreground">
          {parsing ? "等待第一条日志…" : "点击「解析全部」或「导入此包」后日志会出现在这里。"}
        </div>
      ) : (
        <div
          ref={consoleRef}
          className="h-48 overflow-y-auto rounded-lg border border-border bg-black/70 p-3 font-mono text-[11px] leading-relaxed"
        >
          {logs.map((log, idx) => (
            <div
              key={`log-${idx}`}
              data-log-row
              className={log.level === "error" ? "text-red-400" : "text-emerald-300/90"}
            >
              {log.msg}
            </div>
          ))}
          {parsing && <div className="text-gray-500">…</div>}
        </div>
      )}
    </div>
  );
}

/** Per-package report cards ("最近解析结果") — lifted verbatim from the main
 *  component's "nodes" tab render. */
export function ReportCards({ report }: { report: ParseReport }) {
  return (
    <div className="mt-2">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-medium text-ink">最近解析结果</span>
        <span className="text-xs text-muted-foreground">
          {/* eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access -- report 为解析报告，按任意结构读取 mode/addedNodes */}
          {(report as any).mode === "subset"
            ? `增量 +${
              // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access -- 同上，按任意结构读取 addedNodes
              (report as any).addedNodes ?? 0
            }`
            : `${report.pathCount} 个目录 · ${report.totalNodes} 个节点`}
          {report.errorCount ? ` · ${report.errorCount} 个错误` : ""}
        </span>
      </div>
      <div className="space-y-2">
        {(report.packages ?? []).map((pkg) => {
          const st = STATUS_STYLE[pkg.status] ?? STATUS_STYLE.ok;
          return (
            <div key={pkg.name} className="rounded-xl border border-border bg-bg p-3">
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
                  <div className="truncate font-mono text-[11px] text-muted-foreground" title={pkg.path}>
                    {pkg.path}
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="text-lg font-semibold" style={{ color: st!.fg }}>
                    {pkg.nodeCount}
                  </div>
                  <div className="text-[11px] text-muted-foreground">节点类型</div>
                </div>
              </div>
              {pkg.nodeTypes?.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {pkg.nodeTypes.slice(0, 24).map((ct) => (
                    <span
                      key={ct}
                      className="rounded-md bg-white/4 px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground"
                    >
                      {ct}
                    </span>
                  ))}
                  {pkg.nodeTypes.length > 24 && (
                    <span className="rounded-md bg-white/4 px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
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
  );
}
