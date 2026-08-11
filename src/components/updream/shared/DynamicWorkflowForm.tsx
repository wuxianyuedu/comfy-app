"use client";

import React, { useCallback, useMemo, useRef, useState } from "react";
import { NumberField } from "@/components/updream/ui/NumberField";
import { uploadImageFile } from "@/components/updream/canvas/canvas-helpers";
import {
  splitWorkflowIO,
  numericBounds,
  ioLabel,
  isInputFilled,
  type WorkflowIOMap,
  type ControlKind,
} from "./workflow-io";

/* ── DynamicWorkflowForm ──
 * Renders the parameter form for a custom ComfyUI workflow strictly from the
 * pins the author exposed in IO-edit mode.  No hard-coded 提示词/CFG/种子 —
 * a workflow that exposes one `text` pin gets exactly one textarea; a
 * workflow that exposes nothing gets an actionable hint instead of a wall of
 * irrelevant fields.
 *
 * Shared by CreatePanel（宽版）and the canvas `workflow` node（compact）. */

const inputCls =
  "w-full rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-[12px] text-gray-200 placeholder:text-gray-500 outline-none transition-colors focus:border-violet-500/40";
const ghostBtnCls =
  "w-full truncate rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-left text-[12px] text-gray-300 transition-colors hover:bg-white/[0.06] disabled:opacity-40";

/** Colour accent per control kind — mirrors the canvas port palette. */
const ACCENT: Record<ControlKind, string> = {
  image: "#5BE3C4",
  textarea: "#FF9C5B",
  text: "#FF9C5B",
  switch: "#67E89D",
  int: "#B584FF",
  float: "#FFD571",
  link: "#5BC6FF",
};

const TYPE_BADGE = "rounded px-1 py-px font-mono text-[9px] uppercase tracking-wide";

/** Inline-editable label row.  When `onChange` is set, the label text is
 *  click-to-edit: a single click swaps the <span> for an <input> pre-filled
 *  with the current value; Enter or blur commits; Escape reverts.  When
 *  `onChange` is undefined (the default), this falls back to a plain span
 *  identical to the previous behaviour — so the existing CanvasNode usage
 *  (read-only canvas form) is unaffected.
 *
 *  Visual cue: a small ✏ icon appears next to the label when `onChange` is
 *  set, so authors can tell at a glance which labels are user-editable.
 *  Hovering the row turns the icon from 30% to 100% opacity. */
function EditableLabel({
  label,
  title,
  onChange,
}: {
  label: string;
  title?: string;
  onChange?: (next: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(label);
  const inputRef = useRef<HTMLInputElement>(null);
  const editable = typeof onChange === "function";

  React.useEffect(() => {
    setDraft(label);
  }, [label]);

  React.useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  if (!editable || !editing) {
    return (
      <span
        className="group flex min-w-0 flex-1 items-center gap-1 truncate text-[11px] font-medium text-gray-300"
        title={title}
      >
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {editable && (
          <button
            type="button"
            aria-label="编辑名称"
            title="编辑名称"
            onClick={(e) => {
              e.stopPropagation();
              setDraft(label);
              setEditing(true);
            }}
            onMouseDown={(e) => e.stopPropagation()}
            className="shrink-0 text-[10px] text-gray-500 opacity-30 transition-opacity hover:opacity-100 group-hover:opacity-70"
          >
            ✎
          </button>
        )}
      </span>
    );
  }

  const commit = () => {
    const next = draft.trim();
    /* No-op when the trimmed value is unchanged — avoids dirtying the
     * workflowIO map on every blur. */
    if (next && next !== label) onChange?.(next);
    else setDraft(label);
    setEditing(false);
  };

  return (
    <span className="flex min-w-0 flex-1 items-center gap-1">
      <input
        ref={inputRef}
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          } else if (e.key === "Escape") {
            e.preventDefault();
            setDraft(label);
            setEditing(false);
          }
        }}
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
        title={title}
        className="nodrag nopan min-w-0 flex-1 rounded border border-violet-400/40 bg-white/[0.06] px-1.5 py-px text-[11px] font-medium text-gray-200 outline-none focus:border-violet-400/70"
      />
    </span>
  );
}

export interface DynamicWorkflowFormProps {
  /** Enriched workflowIO map from GET /api/workflows/[id]. */
  io: WorkflowIOMap | null | undefined;
  /** Current values, keyed by ioKey. */
  values: Record<string, unknown>;
  /** Receives the full next value map (caller owns the state). */
  onChange: (next: Record<string, unknown>) => void;
  loading?: boolean;
  disabled?: boolean;
  /** Tighter spacing + single column, for the 300px-wide canvas node. */
  compact?: boolean;
  /** Render the "此工作流输出" strip below the inputs. */
  showOutputs?: boolean;
  /** Override the hint shown when the workflow exposes no input pins. */
  emptyHint?: React.ReactNode;
  /** When set, each input row's label becomes click-to-edit (pencil icon →
   *  click → inline <input> → blur / Enter commits).  The new label is
   *  written into `workflowIO[key].label`, where `key` is the ioKey.  This
   *  is the UX for IO-edit mode's preview panel: the author sees exactly
   *  what the form will look like and can rename each pin in-place. */
  onLabelChange?: (ioKey: string, label: string) => void;
  /** 2026-08-11 (R57): when set, every widget row gets a "必填 / 可选"
   *  toggle button next to the label.  Clicking it flips
   *  `workflowIO[ioKey].required`.  Required rows that are still empty
   *  render the input with a red border to keep the author honest.  This
   *  is the IO-edit-mode counterpart of `onLabelChange`. */
  onRequiredChange?: (ioKey: string, required: boolean) => void;
}

export function DynamicWorkflowForm({
  io,
  values,
  onChange,
  loading = false,
  disabled = false,
  compact = false,
  showOutputs = true,
  emptyHint,
  onLabelChange,
  onRequiredChange,
}: DynamicWorkflowFormProps) {
  const { wireInputs, widgetInputs, inputs, outputs } = useMemo(() => splitWorkflowIO(io), [io]);
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploadTarget, setUploadTarget] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const set = useCallback(
    (ioKey: string, v: unknown) => onChange({ ...values, [ioKey]: v }),
    [values, onChange]
  );

  const pickFile = useCallback((ioKey: string) => {
    setUploadTarget(ioKey);
    fileRef.current?.click();
  }, []);

  const onFile = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const f = e.target.files?.[0];
      e.target.value = "";
      if (!f || !uploadTarget) return;
      setUploading(true);
      try {
        const name = await uploadImageFile(f);
        set(uploadTarget, name);
      } catch (err) {
        console.error("[DynamicWorkflowForm] upload failed", err);
      } finally {
        setUploading(false);
        setUploadTarget(null);
      }
    },
    [uploadTarget, set]
  );

  if (loading) {
    return (
      <div className="space-y-2">
        {[0, 1, 2].map((i) => (
          <div key={i} className="space-y-1.5">
            <div className="h-2.5 w-16 animate-pulse rounded bg-white/[0.06]" />
            <div className="h-8 w-full animate-pulse rounded-lg bg-white/[0.04]" />
          </div>
        ))}
      </div>
    );
  }

  /* No curated IO at all → tell the user exactly how to fix it. */
  if (inputs.length === 0 && outputs.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-white/[0.12] bg-white/[0.02] px-3 py-3 text-[11px] leading-relaxed text-gray-400">
        {emptyHint ?? (
          <>
            该工作流尚未标记对外参数。
            <br />
            打开工作流编辑器 → 顶栏「IO 编辑」→ 勾选想要暴露的输入/输出，保存后这里会自动出现对应的表单。
          </>
        )}
      </div>
    );
  }

  const gridCls = compact ? "space-y-2.5" : "space-y-3";

  /* Section header used for the two sub-sections in IO edit/preview mode
   *  (2026-08-09).  Same visual scaffolding as before; kept inside the
   *  component because it's only ever consumed here, and duplicating it
   *  across callers would risk divergence. */
  const SectionHeader = ({ label, count, accent }: { label: string; count: number; accent: string }) => (
    <div className="flex items-center gap-2 border-t border-white/[0.06] pt-2.5">
      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: accent }} />
      <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">{label}</span>
      <span className="rounded-full bg-white/[0.06] px-1.5 py-px font-mono text-[10px] text-gray-500">{count}</span>
      <div className="flex-1 border-t border-dashed border-white/[0.04]" />
    </div>
  );

  /* Render a single editable input row (text / textarea / number / switch /
   *  image upload).  Used for widget-backed pins only — wire pins render
   *  as read-only chips via the dedicated block below. */
  const renderInputRow = (e: (typeof widgetInputs)[number]) => {
    const accent = ACCENT[e.control];
    const label = ioLabel(e);
    const v = values[e.ioKey];

    if (e.control === "link") {
      return (
        <div key={e.ioKey} className="flex items-center gap-2 rounded-lg border border-white/[0.06] bg-white/[0.02] px-2.5 py-1.5">
          <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: accent }} />
          <span className="min-w-0 flex-1 truncate text-[11px] text-gray-400">{label}</span>
          <span className={TYPE_BADGE} style={{ color: accent, background: `${accent}18` }}>
            {e.type}
          </span>
        </div>
      );
    }

    return (
      <div key={e.ioKey}>
        <div className="mb-1.5 flex items-center gap-1.5">
          <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: accent }} />
          <EditableLabel
            label={label}
            title={`${e.nodeTitle ?? ""} · ${e.name}`}
            onChange={onLabelChange ? (next) => onLabelChange(e.ioKey, next) : undefined}
          />
          {/* R57: 必填 / 可选 toggle.  Only rendered when the form has an
           *  owner for the callback (i.e. IO-edit-mode preview panel) —
           *  pure run-time forms (CreatePanel / CanvasNode) hide it so the
           *  user can't change workflow contracts from a consumer view. */}
          {onRequiredChange && (
            <button
              type="button"
              title={
                e.required
                  ? "已标记为必填，点击切换为可选"
                  : "点击将其标记为必填"
              }
              onClick={(ev) => {
                ev.stopPropagation();
                onRequiredChange(e.ioKey, !e.required);
              }}
              onMouseDown={(ev) => ev.stopPropagation()}
              className={`shrink-0 rounded px-1.5 py-px text-[10px] font-medium transition-colors ${
                e.required
                  ? "border border-red-400/40 bg-red-500/15 text-red-300 hover:bg-red-500/25"
                  : "border border-white/[0.08] bg-white/[0.02] text-gray-500 hover:bg-white/[0.06] hover:text-gray-300"
              }`}
            >
              {e.required ? "必填" : "可选"}
            </button>
          )}
          <span className={TYPE_BADGE} style={{ color: accent, background: `${accent}18` }}>
            {e.type}
          </span>
        </div>

        {e.control === "textarea" && (
          <textarea
            className={`${inputCls} ${
              e.required && !isInputFilled(v) ? "border-red-400/50" : ""
            }`}
            rows={compact ? 3 : 4}
            value={typeof v === "string" ? v : ""}
            disabled={disabled}
            placeholder={`输入 ${label}${e.required ? "（必填）" : ""}`}
            onChange={(ev) => set(e.ioKey, ev.target.value)}
          />
        )}

        {e.control === "text" && (
          <input
            className={`${inputCls} ${
              e.required && !isInputFilled(v) ? "border-red-400/50" : ""
            }`}
            value={typeof v === "string" || typeof v === "number" ? String(v) : ""}
            disabled={disabled}
            placeholder={`输入 ${label}${e.required ? "（必填）" : ""}`}
            onChange={(ev) => set(e.ioKey, ev.target.value)}
          />
        )}

        {(e.control === "int" || e.control === "float") &&
          (() => {
            const b = numericBounds(e);
            return (
              <NumberField
                value={typeof v === "number" ? v : Number(v) || b.min}
                onChange={(n) => set(e.ioKey, n)}
                min={b.min}
                max={b.max}
                step={b.step}
                decimalPlaces={e.control === "float" ? b.decimalPlaces : 0}
                disabled={disabled}
              />
            );
          })()}

        {e.control === "switch" && (
          <button
            type="button"
            disabled={disabled}
            onClick={() => set(e.ioKey, !v)}
            className={`nodrag nopan flex h-[30px] w-full items-center justify-between rounded-lg border px-3 text-[12px] transition-colors ${
              v
                ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-200"
                : "border-white/[0.08] bg-white/[0.03] text-gray-400"
            } ${e.required && !isInputFilled(v) ? "border-red-400/50" : ""}`}
          >
            <span>{v ? "开启" : "关闭"}</span>
            <span
              className={`relative h-3.5 w-7 rounded-full transition-colors ${
                v ? "bg-emerald-400/70" : "bg-white/[0.12]"
              }`}
            >
              <span
                className="absolute top-0.5 h-2.5 w-2.5 rounded-full bg-white transition-all"
                style={{ left: v ? 14 : 3 }}
              />
            </span>
          </button>
        )}

        {e.control === "image" && (
          <button
            type="button"
            className={`${ghostBtnCls} ${
              e.required && !isInputFilled(v) ? "border-red-400/50" : ""
            }`}
            disabled={disabled || uploading}
            onClick={() => pickFile(e.ioKey)}
          >
            {uploading && uploadTarget === e.ioKey
              ? "上传中…"
              : typeof v === "string" && v
                ? `已选：${v}`
                : `上传 ${label}${e.required ? "（必填）" : ""}`}
          </button>
        )}
      </div>
    );
  };

  return (
    <div className={gridCls}>
      <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onFile} />

      {/* Two-section layout (2026-08-09 R6) — matches the user's request:
       *  「只能用连线传递的输入参数 + 输出参数」in one section, 「其余输入参数」
       *  (widget-backed) in another.  The split is driven by the `kind`
       *  field written by toggleIO on the canvas ("param"=wire,
       *  "widget"=editable, "output"=output).  When a section has no
       *  rows it's omitted — a workflow that only exposes widget params
       *  shows just the "可编辑参数" half, and a workflow that's pure
       *  wire (e.g. an output-only subgraph wrapper) shows just the
       *  "I/O 端点" half. */}

      {/* 📥 I/O 端点 — wire inputs (必须连线) + outputs (供外部连线).
       *  Rendered as compact read-only chips; both groups share the
       *  section because they are "the workflow's I/O surface" from
       *  ComfyUI's perspective.  Wire inputs render in the link-color
       *  accent (#5BC6FF), outputs in the image/port green (#5BE3C4)
       *  — visually distinguishable chips within the same section. */}
      {(wireInputs.length > 0 || (showOutputs && outputs.length > 0)) && (
        <>
          <SectionHeader
            label="I/O 端点"
            count={wireInputs.length + (showOutputs ? outputs.length : 0)}
            accent="#5BC6FF"
          />
          {wireInputs.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {wireInputs.map((e) => {
                const accent = ACCENT[e.control] ?? "#5BC6FF";
                const label = ioLabel(e);
                return (
                  <span
                    key={e.ioKey}
                    className="inline-flex items-center gap-1 rounded-md border border-[#5BC6FF]/25 bg-[#5BC6FF]/10 px-1.5 py-0.5 text-[10px] text-[#5BC6FF]"
                    title={`${e.nodeTitle ?? ""} · ${e.name} · 仅可通过连线输入`}
                  >
                    <span className="h-1.5 w-1.5 rounded-full bg-[#5BC6FF]" />
                    {label}
                    <span className="font-mono text-[9px] opacity-70">{e.type}</span>
                  </span>
                );
              })}
            </div>
          )}
          {wireInputs.length > 0 && outputs.length > 0 && showOutputs && (
            <div className="h-px shrink-0 border-t border-dashed border-white/[0.06]" />
          )}
          {showOutputs && outputs.length > 0 && (
            <>
              <div className="flex items-center gap-1.5 pt-1">
                <span className="text-[10px] font-medium text-gray-500">输出端点</span>
                <div className="flex-1 border-t border-dashed border-white/[0.04]" />
              </div>
              <div className="flex flex-wrap gap-1.5">
                {outputs.map((o) => (
                  <span
                    key={o.ioKey}
                    className="inline-flex items-center gap-1 rounded-md border border-[#5BE3C4]/25 bg-[#5BE3C4]/10 px-1.5 py-0.5 text-[10px] text-[#5BE3C4]"
                    title={`${o.nodeTitle ?? ""} · ${o.name}`}
                  >
                    <span className="h-1.5 w-1.5 rounded-full bg-[#5BE3C4]" />
                    {ioLabel(o)}
                    <span className="font-mono text-[9px] opacity-70">{o.type}</span>
                  </span>
                ))}
              </div>
            </>
          )}
        </>
      )}

      {/* 🔧 可编辑参数 — widget-backed inputs the user can tune before
       *  running the workflow.  The header is omitted when this section
       *  has no rows (avoid section noise on output-only workflows). */}
      {widgetInputs.length > 0 && (
        <>
          <SectionHeader label="可编辑参数" count={widgetInputs.length} accent="#FF9C5B" />
          {widgetInputs.map(renderInputRow)}
        </>
      )}
    </div>
  );
}

export default DynamicWorkflowForm;
