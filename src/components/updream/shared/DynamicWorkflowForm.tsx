"use client";

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Handle, Position } from "@xyflow/react";
import { NumberField } from "@/components/updream/ui/NumberField";
import { DarkSelect } from "@/components/updream/ui/DarkSelect";
import { uploadImageFile } from "@/components/updream/canvas/canvas-helpers";
import {
  splitWorkflowIO,
  numericBounds,
  ioLabel,
  isInputFilled,
  inferGroups,
  type WorkflowIOMap,
  type WorkflowIOEntry,
  type ControlKind,
} from "./workflow-io";
import { GroupedControls } from "./GroupedControls";

/* ── DynamicWorkflowForm ──
 * Renders the parameter form for a custom ComfyUI workflow strictly from the
 * pins the author exposed in IO-edit mode.  No hard-coded 提示词/CFG/种子 —
 * a workflow that exposes one `text` pin gets exactly one textarea; a
 * workflow that exposes nothing gets an actionable hint instead of a wall of
 * irrelevant fields.
 *
 * Shared by CreatePanel（宽版）and the canvas `workflow` node（compact）. */

/** v2 (2026-08-14) Aligned with Ardot 3:40 PortRow1:
 *  - bg #0F0F14 (深于卡片 #16161C)
 *  - rounded-[6px]  +  no border
 *  - 11pt Inter Regular, color #C9C9D6
 *  - p-2.5 (10px) on all sides
 *  - leading-relaxed (16-17px line-height for 11pt)
 *  - resize-none — 稿是固定 52h，不该出现 webkit resize 把手
 *  - placeholder #5A5A6B */
const inputCls =
  "nodrag nopan w-full resize-none rounded-md bg-[#0F0F14] p-2.5 text-[11px] leading-relaxed text-[#C9C9D6] outline-none transition-colors placeholder:text-[#5A5A6B] focus:ring-1 focus:ring-[#7C5CFC]/40";
const ghostBtnCls =
  "nodrag nopan w-full truncate rounded-md bg-[#0F0F14] px-2.5 py-2 text-left text-[11px] text-[#C9C9D6] transition-colors hover:bg-[#0F0F14]/80 disabled:opacity-40";

/** Colour accent per control kind — mirrors the canvas port palette. */
const ACCENT: Record<ControlKind, string> = {
  image: "#5BE3C4",
  textarea: "#FF9C5B",
  text: "#FF9C5B",
  select: "#8B7CFC",
  switch: "#67E89D",
  int: "#B584FF",
  float: "#FFD571",
  link: "#5BC6FF",
};

/** v2 TypeChip — matches Ardot 3:44 TypeChip-STRING (50×16, r=3, bg #26262E, text #9A9AAD).
 *  统一用 port chip 配色，control 类型不再决定 chip 颜色（与稿一致）。 */
const TYPE_BADGE =
  "inline-flex items-center rounded-[3px] px-1.5 py-0.5 text-[10px] font-semibold";

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
      /* R-ardot56 (2026-08-15): 字体与 outputs label 一致 — text-[12px] font-semibold
       *  text-[#EDEDF2] + 'Inter' font-family，与 outputs 的 `text-[12px] font-semibold
       *  text-[#EDEDF2] font-Inter'` 视觉严格对齐，让 inputs 与 outputs 在同一节点内
       *  拥有相同字体权重的 label。 */
      <span
        className="group flex min-w-0 flex-1 items-center gap-1 truncate text-[12px] font-semibold text-[#EDEDF2]"
        style={{ fontFamily: "'Inter', system-ui, sans-serif" }}
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
        /* R-ardot56 (2026-08-15): 与展示态字体一致 — text-[12px] font-semibold
         *  text-[#EDEDF2] + 'Inter'，避免编辑切回展示态时出现字重跳变。 */
        className="nodrag nopan min-w-0 flex-1 rounded border border-violet-400/40 bg-white/[0.06] px-1.5 py-px text-[12px] font-semibold text-[#EDEDF2] outline-none focus:border-violet-400/70"
        style={{ fontFamily: "'Inter', system-ui, sans-serif" }}
      />
    </span>
  );
}

export interface DynamicWorkflowFormProps {
  /** Enriched workflowIO map from GET /api/workflows/[id]. */
  io: WorkflowIOMap | null | undefined;
  /** Current values, keyed by ioKey. */
  values: Record<string, unknown>;
  /** R-ardot98 (2026-08-17): owning workflow id, used to persist the user's
   *  chosen group fill-paradigm (分别填写 ⇄ 比例+清晰度 / 时长+画质+比例) in
   *  localStorage so the preference survives reloads.  Omit to fall back to
   *  a per-browser global key. */
  workflowId?: string;
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
  /** Canvas-only: per-pin seed "control after generate" mode, keyed by ioKey.
   *  Rendered as a clickable chip on seed-like int rows so the user can pick
   *  fixed / increment / decrement / random without leaving the node. */
  seedModes?: Record<string, string>;
  onSeedModeChange?: (ioKey: string, mode: string) => void;
  /** R-ardot35 (2026-08-15): when set, rows in the rendered list become
   *  drag-to-reorder — the author picks up a row by its drag handle and
   *  drops it onto another row to insert immediately before it.  The
   *  callback receives `(fromKey, beforeKey | null)`, where `beforeKey
   *  === null` signals "send to the tail of the same group".  The
   *  consumer (typically the IO-edit preview panel) is responsible for
   *  renumbering `displayOrder` and persisting; we only emit the intent
   *  here so this component stays free of persistence concerns.  Not
   *  provided = rows are non-draggable (read-only surfaces like
   *  CreatePanel, WorkflowLibrary, canvas `workflow` node). */
  onReorder?: (fromKey: string, beforeKey: string | null) => void;
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
  seedModes,
  onSeedModeChange,
  onReorder,
  workflowId,
}: DynamicWorkflowFormProps) {
  const { wireInputs, widgetInputs, inputs, outputs } = useMemo(() => splitWorkflowIO(io), [io]);
  /* R-ardot98 (2026-08-17): detect coupled widget groups (dimension = width
   *  + height; video = length + aspect + quality).  The matched pins are
   *  withheld from the generic per-widget rows below and instead rendered by
   *  `GroupedControls` (a single dropdown switches between "分别填写" and the
   *  friendly preset paradigm).  Group membership lives in `groupedKeys`. */
  const groups = useMemo(() => inferGroups(widgetInputs), [widgetInputs]);
  const { groupedKeys } = groups;
  /* R-ardot35 (2026-08-15): local state for the HTML5 drag gesture.
   *  We intentionally keep this in component-local state (not in
   *  workflow-io.ts or any context) so a reorder from one surface
   *  doesn't accidentally steal drag focus from another on the same
   *  page.  `draggingKey` is the ioKey the user picked up; the
   *  `dragOverKey` is the row currently under the cursor — used to
   *  paint a thin violet insert line.  Both are cleared on
   *  dragend / drop so a dropped row doesn't leave a stale
   *  highlight if the parent re-renders. */
  const [draggingKey, setDraggingKey] = useState<string | null>(null);
  const [dragOverKey, setDragOverKey] = useState<string | null>(null);
  /* Drag-handler bundle forwarded to each row.  `onReorder` is the
   *  caller's reorderIO; we wrap it with the local state cleanup
   *  so the consumer never has to know about our internal
   *  highlights.  No-op when reorder is disabled (uncontrolled
   *  prop). */
  const dragHandlers = useMemo(() => {
    if (!onReorder) return null;
    return {
      onDragStart: (ioKey: string) => (e: React.DragEvent<HTMLDivElement>) => {
        setDraggingKey(ioKey);
        setDragOverKey(ioKey);
        /* Required by HTML5 drag — without dataTransfer.setData, Firefox
         *  refuses to actually start the drag.  The payload itself is
         *  ignored; the caller identifies rows by ioKey via state. */
        try {
          e.dataTransfer.setData("text/plain", ioKey);
          e.dataTransfer.effectAllowed = "move";
        } catch {
          /* Some browsers throw on setData outside user gestures; safe to ignore. */
        }
      },
      onDragOver: (ioKey: string) => (e: React.DragEvent<HTMLDivElement>) => {
        if (!draggingKey || draggingKey === ioKey) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        if (dragOverKey !== ioKey) setDragOverKey(ioKey);
      },
      onDragLeave: (ioKey: string) => (_e: React.DragEvent<HTMLDivElement>) => {
        /* Only clear the highlight when the pointer truly leaves the
         *  row — `onDragLeave` fires on every child re-entry too,
         *  so we compare against the current `draggingKey` and
         *  ignore stale leave events.  The actual highlight clears
         *  on the next dragover/drop/dragend. */
        if (dragOverKey === ioKey && draggingKey) return;
      },
      onDrop: (ioKey: string) => (e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        const fromKey = draggingKey;
        setDraggingKey(null);
        setDragOverKey(null);
        if (!fromKey || fromKey === ioKey) return;
        onReorder(fromKey, ioKey);
      },
      onDragEnd: () => {
        setDraggingKey(null);
        setDragOverKey(null);
      },
    };
  }, [onReorder, draggingKey, dragOverKey]);
  // 2026-08-14 (Ardot v2 对齐)：端口行包含「wire inputs」+「数值类 widget
  // (seed/steps/cfg 等 INT/FLOAT)」。两者都应有可连接的左侧 handle；数值行
  // 走 Ardot PortRowInt 风格（单行 33h · label spacer input chip），与稿
  // 3:52 完全一致；其它 widget（select / switch / text / textarea / 纯 link）
  // 只在「可编辑参数」里渲染，由 `renderInputRow` 处理（含 SeedModeButton
  // 等 widget 段专属 UI——目前数值行也支持 SeedModeButton）。
  const portEntries = useMemo(
    () => [
      ...wireInputs,
      // 数值类 widget（seed/steps/cfg 等 ComfyUI INT/FLOAT/NUMBER）→ 端口行，
      // 让 Ardot PortRowInt 单行 33h 布局生效；SeedModeButton 通过
      // `WirePortRows` 的 props 注入。R-ardot98: 命中 group 的数值 widget
      // （width/height 等）在此剔除，改由 GroupedControls 统一渲染。
      ...widgetInputs.filter((e) => {
        const t = (e.type || "").toUpperCase();
        return (t === "INT" || t === "FLOAT" || t === "NUMBER") && !groupedKeys.has(e.ioKey);
      }),
    ],
    [wireInputs, widgetInputs, groupedKeys]
  );
  // 数值类 widget 由 `WirePortRows` 处理；这里只保留非数值 widget。
  // R-ardot98: 命中 group 的非数值 widget 同样剔除（避免与 GroupedControls 重复）。
  const widgetSectionEntries = useMemo(
    () =>
      widgetInputs.filter((e) => {
        const t = (e.type || "").toUpperCase();
        return t !== "INT" && t !== "FLOAT" && t !== "NUMBER" && !groupedKeys.has(e.ioKey);
      }),
    [widgetInputs, groupedKeys]
  );
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

  // 紧凑（画布）模式：端口行紧贴，对齐 Ardot 稿（测试节点端口行无间隔）
  const gridCls = compact ? "space-y-0" : "space-y-3";

  /* Section header used for the two sub-sections in IO edit/preview mode
   *  (2026-08-09).  Same visual scaffolding as before; kept inside the
   *  component because it's only ever consumed here, and duplicating it
   *  across callers would risk divergence. */
  const SectionHeader = ({ label, count, accent }: { label: string; count: number; accent: string }) => (
    <div className="mt-1 flex items-center gap-2 border-t border-white/[0.1] pt-2.5">
      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: accent }} />
      <span className="text-[10px] font-semibold uppercase tracking-wider text-[#9A9AAD]">{label}</span>
      <span className="rounded-full bg-white/[0.1] px-1.5 py-px font-mono text-[10px] text-gray-400">{count}</span>
      <div className="flex-1 border-t border-dashed border-white/[0.08]" />
    </div>
  );

  /* Render a single editable input row (text / textarea / number / switch /
   *  image upload).  Used for widget-backed pins only — wire pins render
   *  as read-only chips via the dedicated block below.
   *
   *  v3 (2026-08-14): 当 `withHandle=true` 时，给该行挂一个左侧 PortHandle，
   *  与 WirePortRows 的端口行在视觉上完全一致（圆心骑跨 Card 左缘 0），
   *  让 widget 行（STRING 文本/textarea）也作为可连接的输入端点出现。
   *  Handle 挂在 subrow 内（圆心 = subrow 中心 = 14，相对 row y），与
   *  Ardot 稿 H-pos-in y=85 / 圆心 91 严格一致。 */
  const renderInputRow = (
    e: (typeof widgetInputs)[number],
    opts: { withHandle?: boolean } = {}
  ) => {
    const withHandle = !!opts.withHandle;
    const accent = ACCENT[e.control];
    /* 2026-08-15: pass `inputs + outputs` so two pins that happen to
     *  resolve to the same label (e.g. both rendered as `image`)
     *  fall back to the raw `name` and stay visually distinguishable. */
    const label = ioLabel(e, [...inputs, ...outputs]);
    const v = values[e.ioKey];

    /* Shared sub-row pieces — used in both compact (inline) and wide
     * (label-on-top) layouts so we don't drift between the two. */
    const typeChip = (
      <span
        className="inline-flex shrink-0 items-center rounded-[3px] px-1.5 py-0.5 text-[10px] font-semibold"
        style={{
          fontFamily: "'Inter', system-ui, sans-serif",
          background: "#26262E",
          color: "#9A9AAD",
        }}
      >
        {/* R-ardot93-A (2026-08-17): previous edit (R-ardot92) wired this
         *  through `normalizeTypeChip()` only on the WirePortRows path.
         *  The wide/compact label-on-top path renders the chip via this
         *  shared `typeChip` const — which still printed `{e.type}`
         *  raw.  When ComfyUI's `control_after_generate` enum leaks
         *  through API-only enrichment (`"fixed"`/`"randomize"`/…),
         *  the chip showed that string instead of `INT`.  Unify the
         *  two paths on `normalizeTypeChip()`. */}
        {normalizeTypeChip(e.type, e.control === "float" ? "FLOAT" : "INT")}
      </span>
    );
    const labelText = (
      <EditableLabel
        label={label}
        title={`${e.nodeTitle ?? ""} · ${e.name}`}
        onChange={onLabelChange ? (next) => onLabelChange(e.ioKey, next) : undefined}
      />
    );
    /* ACCENT 圆点 + 必填/可选 toggle 仅 IO-edit 模式用 (CreatePanel /
     *  CanvasNode 隐藏)。 */
    const accentDot = onRequiredChange ? (
      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: accent }} />
    ) : null;
    const requiredToggle = onRequiredChange ? (
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
        className={`nodrag nopan shrink-0 rounded px-1.5 py-px text-[10px] font-medium transition-colors ${
          e.required
            ? "border border-red-400/40 bg-red-500/15 text-red-300 hover:bg-red-500/25"
            : "border border-white/[0.08] bg-white/[0.02] text-gray-500 hover:bg-white/[0.06] hover:text-gray-300"
        }`}
      >
        {e.required ? "必填" : "可选"}
      </button>
    ) : null;

/* R-ardot50 (2026-08-15): compact（画布 workflow 节点）模式拆成
 *  双行 — **第 1 行 label + 类型 badge**，**第 2 行控件独占一行**。
 *  R-ardot49 的 inline 布局把 label/type/control 都塞进同一行 → 控件
 *  被压缩、label 视觉基线错位，5 个参数上下不对齐。这次回归 label-on-top
 *  + control-below 双行结构，所有 label 视觉中心对齐到第一行基线，所有
 *  控件在第二行获得全宽，与 R-ardot21 的 AutoResizeTextarea 行为一致。
 *
 *  布局（compact）：
 *    wrapper `relative`，内部两块 px-[14px]：
 *      block A: [dot + EditableLabel + 必填/可选 | typeChip]   h-5
 *      block B: [控件 自适应 / minH 28 maxH 80]                 全宽
 *  控件走与 wide 同一套 `renderControl()`，仅 compact 分支调整为
 *  压缩高度 (h-[28px] / AutoResize minH=28 maxH=80)。
 */
const labelRow = (
  <div className="flex h-5 items-center justify-between gap-2.5">
    <span className="flex min-w-0 flex-1 items-center gap-1.5">
      {accentDot}
      {labelText}
      {requiredToggle}
    </span>
    {typeChip}
  </div>
);

    if (e.control === "link") {
      // link-only 类型无可用控件（仍挂 Handle，方便用户连 link 类型数据）
      if (compact) {
        return (
          <div key={e.ioKey} className="relative">
            {withHandle && <PortHandle id={e.ioKey} dir="in" type={e.type} style={{ top: 16, transform: "translateY(-50%)" }} />}
            <div className="px-[14px] pt-1.5">{labelRow}</div>
            <div className="px-[14px] pt-1 pb-1.5">
              <span className="text-[11px] text-gray-500">只接受连线</span>
            </div>
          </div>
        );
      }
      return (
        <div key={e.ioKey} className="relative">
          {withHandle && <PortHandle id={e.ioKey} dir="in" type={e.type} />}
          <div className="flex items-center gap-2 rounded-md bg-[#0F0F14] px-2.5 py-1.5 pl-[14px] pr-[14px]">
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: accent }} />
            <span className="min-w-0 flex-1 truncate text-[11px] text-[#C9C9D6]">{label}</span>
            <span
              className="inline-flex shrink-0 items-center rounded-[3px] px-1.5 py-0.5 text-[10px] font-semibold"
              style={{ fontFamily: "'Inter', system-ui, sans-serif", background: "#26262E", color: "#9A9AAD" }}
            >
              {e.type}
            </span>
          </div>
        </div>
      );
    }

    /* R-ardot49 (2026-08-15): inline (compact) vs label-on-top (wide) 分支。
     *  textarea 在 compact 下走 AutoResizeTextarea (R-ardot21) 自动增长
     *  + max-h-[80px] 上限 + overflow-y-auto，避免长 prompt 把后续行
     *  标签挤到不同 y 位置 — labels align 依赖此处的行为一致。 */
    const renderControl = (keyPrefix: string) => {
      switch (e.control) {
        case "textarea":
          if (compact) {
            return (
              <AutoResizeTextarea
                key={keyPrefix}
                value={typeof v === "string" ? v : ""}
                placeholder={`输入 ${label}${e.required ? "（必填）" : ""}`}
                onChange={(s) => set(e.ioKey, s)}
                minHeight={28}
                maxHeight={80}
              />
            );
          }
          return (
            <textarea
              key={keyPrefix}
              className={`${inputCls} mt-1.5 min-h-[52px] ${
                e.required && !isInputFilled(v) ? "ring-1 ring-red-400/50" : ""
              }`}
              rows={compact ? 2 : 4}
              value={typeof v === "string" ? v : ""}
              disabled={disabled}
              placeholder={`输入 ${label}${e.required ? "（必填）" : ""}`}
              onChange={(ev) => set(e.ioKey, ev.target.value)}
            />
          );
        case "text":
          return (
            <input
              key={keyPrefix}
              className={`${inputCls} ${compact ? "" : "mt-1"} ${
                e.required && !isInputFilled(v) ? "border-red-400/50" : ""
              }`}
              value={typeof v === "string" || typeof v === "number" ? String(v) : ""}
              disabled={disabled}
              placeholder={`输入 ${label}${e.required ? "（必填）" : ""}`}
              onChange={(ev) => set(e.ioKey, ev.target.value)}
            />
          );
        case "int":
        case "float": {
          const b = numericBounds(e);
          const isSeed = compact && isSeedLike(e);
          if (compact) {
            return (
              /* R-ardot93-B (2026-08-17): previous edit capped the stepper
               *  width at the Card minus padding.  In practice the
               *  flex-1 wrapper made the NumberField stretch the entire
               *  ~285 px of a 340 px wide canvas node — the user asked
               *  for the stepper to "give back" most of that width to
               *  the label column.  Cap at 180 px so 4-digit integers
               *  still fit (8.0 + 2 buttons = ~150 px) while the label
               *  column gets the rest of the Card real-estate to render
               *  "宽度"/"高度"/"步数" without truncation. */
              <div key={keyPrefix} className="flex items-center gap-1.5">
                <div className="min-w-[120px] max-w-[180px]">
                  <NumberField
                    value={typeof v === "number" ? v : Number(v) || b.min}
                    onChange={(n) => set(e.ioKey, n)}
                    min={b.min}
                    max={b.max}
                    step={b.step}
                    decimalPlaces={e.control === "float" ? b.decimalPlaces : 0}
                    disabled={disabled}
                  />
                </div>
                {isSeed && (
                  <SeedModeButton
                    mode={seedModes?.[e.ioKey]}
                    onPick={(m) => onSeedModeChange?.(e.ioKey, m)}
                  />
                )}
              </div>
            );
          }
          return (
            <div key={keyPrefix} className={isSeed ? "mt-1 flex items-center gap-1.5" : "mt-1"}>
              <div className={isSeed ? "flex-1" : undefined}>
                <NumberField
                  value={typeof v === "number" ? v : Number(v) || b.min}
                  onChange={(n) => set(e.ioKey, n)}
                  min={b.min}
                  max={b.max}
                  step={b.step}
                  decimalPlaces={e.control === "float" ? b.decimalPlaces : 0}
                  disabled={disabled}
                />
              </div>
              {isSeed && (
                <SeedModeButton
                  mode={seedModes?.[e.ioKey]}
                  onPick={(m) => onSeedModeChange?.(e.ioKey, m)}
                />
              )}
            </div>
          );
        }
        case "switch":
          if (compact) {
            return (
              <button
                key={keyPrefix}
                type="button"
                disabled={disabled}
                onClick={() => set(e.ioKey, !v)}
                className={`nodrag nopan flex h-[28px] w-full items-center justify-between rounded-md bg-[#0F0F14] px-2.5 text-[12px] transition-colors ${
                  v ? "text-emerald-200" : "text-[#9A9AAD]"
                } ${e.required && !isInputFilled(v) ? "ring-1 ring-red-400/50" : ""}`}
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
            );
          }
          return (
            <button
              key={keyPrefix}
              type="button"
              disabled={disabled}
              onClick={() => set(e.ioKey, !v)}
              className={`nodrag nopan mt-1 flex h-[30px] w-full items-center justify-between rounded-md bg-[#0F0F14] px-3 text-[12px] transition-colors ${
                v ? "text-emerald-200" : "text-[#9A9AAD]"
              } ${e.required && !isInputFilled(v) ? "ring-1 ring-red-400/50" : ""}`}
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
          );
        case "image":
          if (compact) {
            return (
              <button
                key={keyPrefix}
                type="button"
                className={`nodrag nopan inline-flex h-[28px] w-full items-center gap-1.5 rounded-md bg-[#0F0F14] px-2.5 text-[11px] text-[#C9C9D6] transition-colors hover:text-[#EDEDF2] ${
                  e.required && !isInputFilled(v) ? "ring-1 ring-red-400/50" : ""
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
            );
          }
          return (
            <button
              key={keyPrefix}
              type="button"
              className={`nodrag nopan mt-1 inline-flex items-center gap-1.5 rounded-md bg-[#0F0F14] px-2.5 py-1.5 text-[11px] text-[#C9C9D6] transition-colors hover:text-[#EDEDF2] ${
                e.required && !isInputFilled(v) ? "ring-1 ring-red-400/50" : ""
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
          );
        case "select":
          return (
            <DarkSelect
              key={keyPrefix}
              value={typeof v === "string" ? v : ""}
              onChange={(val) => set(e.ioKey, val)}
              options={Array.isArray(e.options) ? e.options : []}
              disabled={disabled}
              placeholder={`选择 ${label}${e.required ? "（必填）" : ""}`}
              className={`w-full ${
                e.required && !isInputFilled(v) ? "ring-1 ring-red-400/50 rounded-md" : ""
              }`}
              popoverMinWidth={compact ? 220 : 260}
            />
          );
        default:
          return null;
      }
    };

/* compact 双行布局 — label-row + control-row。PortHandle 默认
 *  `top:"50%"` 会居中于整段两行，圆点掉在「标题行」与「控件行」之间、
 *  与参数名错位。显式 `style={{ top: 16, transform: "translateY(-50%)" }}`
 *  把圆心锁到 label-row 中线（pt-1.5=6 + h-5/2=10 = 16px），让左侧圆点
 *  与参数名严格同行，连线视觉上正好接在标题行同列。
 */
if (compact) {
  return (
    <div key={e.ioKey} className="relative">
      {withHandle && <PortHandle id={e.ioKey} dir="in" type={e.type} style={{ top: 16, transform: "translateY(-50%)" }} />}
      {/* block A — label + 类型 badge */}
      <div className="px-[14px] pt-1.5">{labelRow}</div>
      {/* block B — 控件独占一行（h 28 自动 / AutoResize minH 28 maxH 80） */}
      <div className="px-[14px] pt-1 pb-1.5">{renderControl("compact-" + e.ioKey)}</div>
    </div>
  );
}

    /* Wide 布局：label-on-top + control-below（保持原貌，给 CreatePanel
     *  与 IO-edit 预览面板的较宽场景用）。 */
    return (
      <div key={e.ioKey} className="relative">
        {/* R-ardot24 (2026-08-14): PortHandle 提升到 wrapper 外（Card 直接
         *  子元素的 relative 容器），让 `left: -6` 重新相对 Card 自己 →
         *  圆心在 Card 左外 6px（骑跨边框）。R-ardot23 把 wrapper 改成
         *  `px-[14px]` 后，PortHandle 留在 subrow 内、subrow 又不带 padding，
         *  圆心相对 subrow = Card 左 + 14 - 6 = Card 内 8px——和 WirePortRows
         *  端口行（PortRow 容器 pl-14 + PortHandle left:-6 = Card 外 -6 骑跨）
         *  差 14px。两个 handle x 位置实测 text/text_1 cx=362 vs seed
         *  cx=334，差 28px（14×2，正是 padding 叠加的副作用）。
         * 提升到 wrapper 外后与 PortRow 共用同一个 Card 边框基准，所有
         * input handle 圆心统一落在 Card 左外 6px。*/}
        {withHandle && <PortHandle id={e.ioKey} dir="in" type={e.type} />}
        {/* v3 subrow：与 Ardot 3:155 PosSubRow 一致 — h-4 + SPACE_BETWEEN
         *  (label 左对齐 / chip 右对齐)；与端口行（WirePortRows）共用布局。
         *  withHandle 时挂左侧 PortHandle（圆心骑跨 Card 左缘 0）。
         *  row wrapper pt-1.5 = Ardot PortRow paddingTop=6 → subrow 圆心
         *  y_in_row=14 (6 padding + 8 subrow h/2) → Card 内圆心 y=
         *  row.y+14 = 77+14=91 (PortRow1) / 163+14=177 (PortRow2)，
         *  与稿 H-pos-in/H-neg-in 圆心实测完全吻合。
         *
         *  R-ardot23 (2026-08-14): horizontal inset 改由 wrapper 的
         *  `px-[14px]` 提供；之前用 `mx-[14px]` margin 会让子控件在
         *  `w-full` + 默认 `content-box` 下整体比 Card 宽出 ~48px
         *  (28 margin + 20 padding)，textarea 越过 Card 右缘。改 padding
         *  之后所有子控件的 `w-full` 都精确等于 Card 内宽（340 - 28 = 312）。
         *
         *  R-ardot50 (2026-08-15): wide 也复用上方的 `labelRow`，
         *  与 compact 仅内边距不同，避免 label-row 漂移。 */}
        <div className="px-[14px] pt-1.5">{labelRow}</div>

        {e.control === "textarea" && (
          <textarea
            className={`${inputCls} mt-1.5 min-h-[52px] ${
              e.required && !isInputFilled(v) ? "ring-1 ring-red-400/50" : ""
            }`}
            rows={4}
            value={typeof v === "string" ? v : ""}
            disabled={disabled}
            placeholder={`输入 ${label}${e.required ? "（必填）" : ""}`}
            onChange={(ev) => set(e.ioKey, ev.target.value)}
          />
        )}

        {e.control === "text" && (
          <input
            className={`${inputCls} mt-1 ${
              e.required && !isInputFilled(v) ? "border-red-400/50" : ""
            }`}
            value={typeof v === "string" || typeof v === "number" ? String(v) : ""}
            disabled={disabled}
            placeholder={`输入 ${label}${e.required ? "（必填）" : ""}`}
            onChange={(ev) => set(e.ioKey, ev.target.value)}
          />
        )}

        {(e.control === "int" || e.control === "float") && (
          (() => {
            const b = numericBounds(e);
            const isSeed = compact && isSeedLike(e);
            return (
              <div className={isSeed ? "mt-1 flex items-center gap-1.5" : "mt-1"}>
                <div className={isSeed ? "flex-1" : undefined}>
                  <NumberField
                    value={typeof v === "number" ? v : Number(v) || b.min}
                    onChange={(n) => set(e.ioKey, n)}
                    min={b.min}
                    max={b.max}
                    step={b.step}
                    decimalPlaces={e.control === "float" ? b.decimalPlaces : 0}
                    disabled={disabled}
                  />
                </div>
                {isSeed && (
                  <SeedModeButton
                    mode={seedModes?.[e.ioKey]}
                    onPick={(m) => onSeedModeChange?.(e.ioKey, m)}
                  />
                )}
              </div>
            );
          })()
        )}

        {e.control === "switch" && (
          <button
            type="button"
            disabled={disabled}
            onClick={() => set(e.ioKey, !v)}
            className={`nodrag nopan mt-1 flex h-[30px] w-full items-center justify-between rounded-md bg-[#0F0F14] px-3 text-[12px] transition-colors ${
              v ? "text-emerald-200" : "text-[#9A9AAD]"
            } ${e.required && !isInputFilled(v) ? "ring-1 ring-red-400/50" : ""}`}
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
            className={`nodrag nopan mt-1 inline-flex items-center gap-1.5 rounded-md bg-[#0F0F14] px-2.5 py-1.5 text-[11px] text-[#C9C9D6] transition-colors hover:text-[#EDEDF2] ${
              e.required && !isInputFilled(v) ? "ring-1 ring-red-400/50" : ""
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

        {e.control === "select" && (
          <div className="mt-1">
            <DarkSelect
              value={typeof v === "string" ? v : ""}
              onChange={(val) => set(e.ioKey, val)}
              options={Array.isArray(e.options) ? e.options : []}
              disabled={disabled}
              placeholder={`选择 ${label}${e.required ? "（必填）" : ""}`}
              className={`w-full ${
                e.required && !isInputFilled(v) ? "ring-1 ring-red-400/50 rounded-md" : ""
              }`}
              popoverMinWidth={260}
            />
          </div>
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
       *  "I/O 端点" half.
       *
       *  Compact (canvas) layout (R-ardot11)：所有输入都在输出之上。
       *   · widget 输入（text / textarea / image / select）排在上方，无段头
       *   · WirePortRows 紧跟其后，wire inputs (左端点) → outputs (右端点)
       *  非 compact 维持原来「I/O 端点 / 可编辑参数」双段头分组，便于作者在
       *  CreatePanel 里看清哪些 pin 是连线的、哪些是面板可填的。 */}

      {/* 🔧 可编辑参数 (compact) — 排在 WirePortRows 之前，让所有 input 行
       *  (包括 widget textarea) 都压在 outputs 上方。同时去掉段头，避免在
       *  画布节点上引入测试节点稿没有的视觉噪音。
       *
       *  v3 (R-ardot12)：widget 行也挂左侧 PortHandle（与稿圆心 y=91/177/265
       *  对齐），让 STRING 文本/textarea 也可以被连线。
       *
       *  R-ardot35: when `onReorder` is provided (IO-edit preview only),
       *  wrap each row in a draggable container with a visible drag
       *  handle.  Three visual cues:
       *   1. The handle (vertical dots) on the row's right side so the
       *      user knows it's grabbable.
       *   2. A subtle top-edge violet line on the drop target so the
       *      user can see exactly where the row will land.
       *   3. A 0.5 opacity on the dragging row itself so the rest of
       *      the list keeps its shape during the gesture.
       *  HTML5 drag is preferred over a pointer-based custom handler
       *  because it's free, supports keyboard cancellation (Esc) via
       *  the browser, and the user can drop anywhere in the document
       *  to abort without us needing to listen to global events. */}
      {compact && widgetSectionEntries.length > 0 && (
        <div className="space-y-0">
          {widgetSectionEntries.map((e) => {
            const isDragging = dragHandlers && draggingKey === e.ioKey;
            const isDropTarget = dragHandlers && dragOverKey === e.ioKey && draggingKey && draggingKey !== e.ioKey;
            const row = renderInputRow(e, { withHandle: true } as const);
            if (!dragHandlers) return row;
            return (
              <div
                key={e.ioKey}
                draggable
                onDragStart={dragHandlers.onDragStart(e.ioKey)}
                onDragOver={dragHandlers.onDragOver(e.ioKey)}
                onDragLeave={dragHandlers.onDragLeave(e.ioKey)}
                onDrop={dragHandlers.onDrop(e.ioKey)}
                onDragEnd={dragHandlers.onDragEnd}
                className={`relative ${isDragging ? "opacity-50" : ""}`}
              >
                {/* Top-edge insert line — only the FIRST row in a
                 *  drop-target sequence shows it so the user doesn't
                 *  get a strobe effect from nested rows. */}
                {isDropTarget && (
                  <div className="pointer-events-none absolute inset-x-0 -top-px z-10 h-0.5 bg-violet-400 shadow-[0_0_8px_rgba(124,92,252,0.6)]" />
                )}
                {/* Drag handle (vertical 3-dots).  Sits to the right
                 *  of the row, cursor:grab → grab-active when
                 *  dragging.  The native draggable=true on the parent
                 *  is what actually makes the row pick-up-able, but
                 *  the handle is the visual affordance.  pointer-
                 *  events-none on the dot strip itself lets clicks
                 *  fall through to the input underneath, so a click
                 *  on the handle area still focuses the field. */}
                <div
                  className="pointer-events-none absolute right-1 top-1/2 z-[5] -translate-y-1/2 select-none text-[10px] leading-[6px] text-white/30"
                  aria-hidden
                >
                  ⋮⋮
                </div>
                {row}
              </div>
            );
          })}
        </div>
      )}

      {/* 🧩 组合参数 (R-ardot98)：命中的 dimension / video group 用单一下拉框
       *  切换录入范式，避免 width/height、时长/画质/比例 散落成多个独立框。
       *  非 compact（CreatePanel / IO-edit 预览）会带「组合参数」段头。 */}
      {(groups.dimension || groups.video) && (
        <GroupedControls
          dimension={groups.dimension}
          video={groups.video}
          values={values}
          onChange={onChange}
          workflowId={workflowId}
          compact={compact}
          disabled={disabled}
        />
      )}

      {/* 📥 I/O 端点 — wire inputs (必须连线) + outputs (供外部连线).
       *  R-ardot13：数值 widget（seed/steps/cfg 等 INT/FLOAT）跟随 widget 段
       *  渲染（即 `widgetSectionEntries` 命中后走 `renderInputRow`），让
       *  `SeedModeButton` 等 widget 段专属 UI 生效；`portEntries` 不再合并
       *  数值 widget，避免数值行在 WirePortRows 与 widget 段重复渲染。 */}
      {(portEntries.length > 0 || (showOutputs && outputs.length > 0)) && (
        <>
          {compact ? (
            <WirePortRows
              wireInputs={portEntries}
              outputs={showOutputs ? outputs : []}
              values={values}
              set={set}
              pickFile={pickFile}
              uploading={uploading}
              uploadTarget={uploadTarget}
              seedModes={seedModes}
              onSeedModeChange={onSeedModeChange}
              /* R-ardot26: 双层守卫 — props 已过滤 outputs=[]，这里再
               *  把 showOutputs 显式透传给 WirePortRows 内部 OutputRow
               *  守卫，未来重构不会复活 images 行 + 紫圆点。 */
              showOutputs={showOutputs}
              /* R-ardot35: thread the drag state + reorder callback
               *  through to port rows so wire inputs and outputs are
               *  also draggable.  The setter callbacks let the parent
               *  own the canonical `draggingKey` — port rows don't
               *  keep their own state, so when a port row picks up
               *  it tells DynamicWorkflowForm "hey, I'm now the
               *  dragging key" and the widget rows + other port rows
               *  paint their highlights based on the same source. */
              draggingKey={draggingKey}
              dragOverKey={dragOverKey}
              onReorder={onReorder}
              onPortDragStart={(k) => {
                setDraggingKey(k);
                setDragOverKey(k);
              }}
              onPortDragEnd={() => {
                setDraggingKey(null);
                setDragOverKey(null);
              }}
            />
          ) : (
            <>
              <SectionHeader
                label="I/O 端点"
                count={wireInputs.length + (showOutputs ? outputs.length : 0)}
                accent="#5BC6FF"
              />
              {wireInputs.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {wireInputs.map((e) => {
                    /* 2026-08-15: conflict-aware — see ioLabel() in
                     *  src/components/updream/shared/workflow-io.ts. */
                    const label = ioLabel(e, [...inputs, ...outputs]);
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
                        {/* 2026-08-15: conflict-aware — see ioLabel(). */}
                        {ioLabel(o, [...inputs, ...outputs])}
                        <span className="font-mono text-[9px] opacity-70">{normalizeTypeChip(o.type)}</span>
                      </span>
                    ))}
                  </div>
                </>
              )}
            </>
          )}
        </>
      )}

      {/* 🔧 可编辑参数 (非 compact) — 留给 CreatePanel 和 IO-edit 的双段头版本。 */}
      {!compact && widgetSectionEntries.length > 0 && (
        <>
          <SectionHeader label="可编辑参数" count={widgetSectionEntries.length} accent="#FF9C5B" />
          {widgetSectionEntries.map((e, _i) => renderInputRow(e))}
        </>
      )}
    </div>
  );
}

/* ── Workflow-canvas endpoint styling (compact canvas mode) ──
 * Port colours per the landed design spec: STRING/INT → neutral grey,
 * IMAGE → violet, VIDEO → pink, link types (MODEL/CLIP/LATENT) → cyan.
 * The stroke is a mid-grey that reads on both the card (#16161C) and the
 * page (#0A0A0F) backgrounds. Handles are 12px and straddle the card
 * border so half sits outside the node, exactly like the workflow canvas. */
const PORT_STROKE = "#4D4D59";
const PORT_IMG = new Set(["IMAGE", "MASK"]);
const PORT_VID = new Set(["VIDEO", "VHS_FILENAMES", "VHS_VIDEOINFO", "VHS_AUDIO", "AUDIO"]);

function portColorFor(type?: string): string {
  const t = (type ?? "").toUpperCase();
  if (PORT_IMG.has(t)) return "#7C5CFC";
  if (PORT_VID.has(t)) return "#FF5CA8";
  if (t === "STRING" || t === "INT" || t === "FLOAT" || t === "NUMBER") return "#9A9AAD";
  if (t === "BOOLEAN" || t === "BOOL") return "#67E89D";
  return "#5BC6FF";
}

/** Type-chip styling for the port-row label (right side of each row).
 *  Matches Ardot v2: STRING/INT/FLOAT → `#26262E` solid + `#9A9AAD` text;
 *  IMAGE/MASK → `#1E1A2E` + `#7C5CFC` 0.4 stroke + `#7C5CFC` text;
 *  VIDEO/AUDIO → `#331A28` + `#FF5CA8` 0.4 stroke + `#FF5CA8` text.
 *
 *  `type` is also normalised up-front: the raw `e.type` can leak through
 *  non-ComfyUI values (`"*"`, `""`, or, historically, stray
 *  `control_after_generate` strings like `"fixed"`/`"randomize"`) when
 *  the workflow was imported as API-only and the enrichment fell back
 *  to JS-type inference.  Any non-{INT,FLOAT,NUMBER} type on a row the
 *  caller already classified as numeric (compact WirePortRows path)
 *  is coerced to INT so the chip is honest about the row's edit semantics. */
function normalizeTypeChip(raw: string | undefined, fallback: "INT" | "FLOAT" = "INT"): string {
  const t = (raw ?? "").toUpperCase();
  if (t === "INT" || t === "FLOAT" || t === "NUMBER" || t === "STRING" || t === "BOOLEAN" || t === "BOOL" || t === "COMBO" || t === "IMAGE" || t === "MASK" || t === "VIDEO" || t === "AUDIO" || t === "*") return t;
  return fallback;
}

function portChipStyle(type?: string): { background: string; color: string; border?: string } {
  const t = normalizeTypeChip(type);
  if (PORT_IMG.has(t)) return { background: "#1E1A2E", color: "#7C5CFC", border: "1px solid rgba(124,92,252,0.4)" };
  if (PORT_VID.has(t)) return { background: "#331A28", color: "#FF5CA8", border: "1px solid rgba(255,92,168,0.4)" };
  return { background: "#26262E", color: "#9A9AAD" };
}

/* R-ardot53 (2026-08-15): export PortHandle — WorkflowNode outputs row
 *  (2026-08-15) 现在也要复用这个端点。要避免飘移，handle 几何参数 / 锚点
 *  / 描边色规则都还在这里维护。 */
export function PortHandle({
  id,
  dir,
  type,
  style: extraStyle,
}: {
  id: string;
  dir: "in" | "out";
  type?: string;
  /** Override / merge into the default positioning (e.g. { top: 14 } for
   *  fixed-height rows).  Ardot v2 anchor defaults still apply unless
   *  overridden here. */
  style?: React.CSSProperties;
}) {
  const color = portColorFor(type);
  // Ardot v2：输入端点描边 `#4D4D59`（卡片/页面底色上都可读），
  // 输出端点描边用卡片底色 `#16161C` 形成「半圆在外/半圆在内」观感。
  const stroke = dir === "out" ? "#16161C" : PORT_STROKE;
  return (
    <Handle
      type={dir === "in" ? "target" : "source"}
      position={dir === "in" ? Position.Left : Position.Right}
      id={id}
      style={{
        position: "absolute",
        width: 12,
        height: 12,
        borderRadius: 9999,
        background: color,
        border: `1px solid ${stroke}`,
        // Ardot 稿：`DROP_SHADOW` rgba(0,0,0,0.25) y4 blur4，节点下方轻投影。
        boxShadow: "0 4px 4px rgba(0,0,0,0.25)",
        // v3 (R-ardot12): Handle 圆心必须挂在 subrow 中心才能精确对齐
        // Ardot 稿 y=91/177/265（PortRow h=86 + PortRow3 h=33 单行结构）。
        // 父元素 (subrow) 必须 `relative`，否则会找更外层的 row wrapper，
        // 圆心落在 row 50% 而不是 subrow 50%，导致圆点偏下。
        ...(dir === "in"
          ? { left: -6, top: "50%", transform: "translateY(-50%)" }
          : { right: -6, top: "50%", transform: "translateY(-50%)" }),
        // v4 (R-ardot16): 行高被严格固定后，Handle 圆心由 caller 用
        // 像素级 top 直接锁（PortRow subrow 圆心 y_in_row=14；PortRowInt
        // 单行圆心 y_in_row=16.5；OutputRow y_in_row=14）。
        ...extraStyle,
      }}
    />
  );
}

/** Auto-growing textarea with width strictly locked to the parent.
 *
 *  R-ardot21 (2026-08-14): replaces the `field-sizing: content` approach
 *  used in R-ardot17/18/20. The native `field-sizing` property was supposed
 *  to give us auto-height while keeping `maxWidth: 100%` as a hard cap, but
 *  Chrome's implementation lets intrinsic content width overflow the parent
 *  when a real prompt's longest unbreakable line exceeds the control's inner
 *  width (282px = Card 340 - 2 border - 14×2 padding). The overflow-X rules
 *  (`overflowWrap: anywhere`, `wordBreak: break-word`) only clip the
 *  visible text — they cannot constrain the textarea's box geometry.
 *
 *  This component instead:
 *   - drives height via JS (scrollHeight after a reset to `auto`), clamped
 *     to [MIN, MAX]; the textarea therefore sizes itself row-by-row, never
 *     relies on the new `field-sizing` API;
 *   - sets `box-sizing: border-box` + `width: 100%` so the box width is
 *     strictly the parent's content box, immune to intrinsic sizing;
 *   - keeps the R-ardot18 horizontal overflow guards (pr-3 > pl-2.5,
 *     overflowX: hidden, overflowWrap: anywhere, wordBreak: break-word);
 *   - keeps the R-ardot19 scrollbar suppression (webkit + firefox + ms).
 */
function AutoResizeTextarea({
  value,
  placeholder,
  onChange,
  minHeight = 28,
  maxHeight = 120,
}: {
  value: string;
  placeholder?: string;
  onChange: (v: string) => void;
  minHeight?: number;
  maxHeight?: number;
}) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const resize = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    // Reset to "auto" so scrollHeight reflects only the natural content height
    // (otherwise it'd be clamped to the previous explicit height).
    el.style.height = "auto";
    const natural = el.scrollHeight;
    const clamped = Math.min(Math.max(natural, minHeight), maxHeight);
    el.style.height = `${clamped}px`;
    el.style.overflowY = natural > maxHeight ? "auto" : "hidden";
  }, [minHeight, maxHeight]);
  // Run after every value change (initial mount + after each keystroke).
  useLayoutEffect(() => {
    resize();
  }, [value, resize]);
  return (
    <textarea
      ref={ref}
      value={value}
      placeholder={placeholder}
      rows={1}
      onChange={(ev) => onChange(ev.target.value)}
      className="nodrag nopan block w-full min-w-0 resize-none overflow-x-hidden rounded-md bg-[#0F0F14] py-2 pl-2.5 pr-3 text-[11px] leading-relaxed text-[#C9C9D6] outline-none placeholder:text-[#5A5A6B]"
      style={{
        fontFamily: "'Inter', system-ui, sans-serif",
        boxSizing: "border-box",
        minHeight,
        maxHeight,
        overflowX: "hidden",
        overflowWrap: "anywhere",
        wordBreak: "break-word",
        scrollbarWidth: "none",
        msOverflowStyle: "none",
      } as React.CSSProperties}
    />
  );
}

/** Connectable port rows for the canvas `workflow` node.  Wire inputs render a
 *  left-straddling handle + a body (STRING → inline textarea, IMAGE → upload
 *  button, link-only types → port only); outputs render a right-aligned name
 *  hugging the type chip + a right-straddling handle.
 *
 *  v3 (R-ardot12): Handle 从外层 row wrapper 移到 subrow 内（subrow 加
 *  `relative`），让 Handle 圆心 = subrow 50% = subrow 16h 中心 y=8（相对 row）。
 *  Ardot H-pos-in y=85 → 圆心 91 = PortRow1 y=77 + subrow 圆心 y_in_row=14 →
 *  与实测一致。字符串行（86h）= subrow 中心；数字行（33h 整行即 subrow）
 *  = 16.5 ≈ 17 → 与 Ardot H-seed-in 圆心 265 一致。 */
function WirePortRows({
  wireInputs,
  outputs,
  values,
  set,
  pickFile,
  uploading,
  uploadTarget,
  seedModes,
  onSeedModeChange,
  /** R-ardot26 (2026-08-14): 画布 workflow 节点是叶节点，不会有下游接线；
   *  默认 false（即不展示 output 行）。CreatePanel / IO-edit 预览面板仍
   *  传 true。L583 调用处已按 `showOutputs ? outputs : []` 过滤过 props，
   *  这里再加守卫是防御 — 防止 WirePortRows 被重构/被错误复用时偷偷
   *  渲染输出行 + source handle。*/
  showOutputs = false,
  /** R-ardot35 (2026-08-15): same drag contract as the widget rows.
   *  Only the IO-edit preview passes these; the rest of the canvas
   *  surfaces leave them undefined and rows stay non-draggable.
   *  Spread onto the row's outer <div> so the entire row becomes
   *  grabbable — the native draggable attribute picks up wherever
   *  the user clicks (no separate handle needed for port rows since
   *  they have no editable input field to compete with). */
  draggingKey,
  dragOverKey,
  onReorder,
  onPortDragStart,
  onPortDragEnd,
}: {
  wireInputs: (WorkflowIOEntry & { ioKey: string; control: ControlKind })[];
  outputs: (WorkflowIOEntry & { ioKey: string })[];
  values: Record<string, unknown>;
  set: (ioKey: string, v: unknown) => void;
  pickFile: (ioKey: string) => void;
  uploading: boolean;
  uploadTarget: string | null;
  /** R-ardot13 (2026-08-14): rendered inline on seed-like numeric rows so
   *  users can flip control_after_generate (固定值 / 递增值 / 递减值 / 随机值)
   *  without leaving the canvas node.  Optional — non-canvas callers may
   *  omit both. */
  seedModes?: Record<string, string>;
  onSeedModeChange?: (ioKey: string, mode: string) => void;
  /** R-ardot26: 内部 OutputRow 守卫。 false 时不渲染 outputs 段。 */
  showOutputs?: boolean;
  /** R-ardot35: see DynamicWorkflowForm.  When provided, every port row
   *  becomes draggable; when undefined, rows render without the
   *  draggable affordance. */
  draggingKey?: string | null;
  dragOverKey?: string | null;
  onReorder?: (fromKey: string, beforeKey: string | null) => void;
  /** R-ardot35: callbacks so the parent can keep its `draggingKey`
   *  state in sync when a port row is the one being dragged.  Mirror
   *  the contract used by widget rows (DynamicWorkflowForm's own
   *  state).  Optional — when omitted the port-row drag still works
   *  for `drop` / `reorder`, only the highlight on the active row is
   *  lost. */
  onPortDragStart?: (ioKey: string) => void;
  onPortDragEnd?: () => void;
}) {
  /* Inline row-level handlers — recreated on every render because
   *  they're tiny, and rebinding the closure each render keeps
   *  `draggingKey` fresh without a useMemo in this hot path.
   *  Drag-state lives in DynamicWorkflowForm (the parent) so the
   *  highlight is consistent across widget rows and port rows; we
   *  thread `onPortDragStart` / `onPortDragEnd` callbacks up so the
   *  parent can update its `draggingKey` setter when a port row
   *  starts / ends its drag. */
  const portDrag = (ioKey: string) => {
    if (!onReorder) return {};
    return {
      draggable: true,
      onDragStart: (e: React.DragEvent<HTMLDivElement>) => {
        try {
          e.dataTransfer.setData("text/plain", ioKey);
          e.dataTransfer.effectAllowed = "move";
        } catch {
          /* Some browsers throw on setData outside user gestures; safe to ignore. */
        }
        onPortDragStart?.(ioKey);
      },
      onDragOver: (e: React.DragEvent<HTMLDivElement>) => {
        if (!draggingKey || draggingKey === ioKey) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
      },
      onDrop: (e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        if (!onReorder || !draggingKey || draggingKey === ioKey) return;
        onReorder(draggingKey, ioKey);
      },
      onDragEnd: () => {
        onPortDragEnd?.();
      },
    };
  };
  return (
    <div className="space-y-0">
      {wireInputs.map((e) => {
        /* 2026-08-15: conflict-aware — see ioLabel() in workflow-io.ts. */
        const label = ioLabel(e, [...wireInputs, ...outputs]);
        const chipStyle = portChipStyle(e.type);
        // 数值类（ComfyUI INT/FLOAT/NUMBER）→ 端口行底部用紧凑数字输入，
        // 避免和 text/textarea/image 分支重复触发。
        const numericType =
          (e.type || "").toUpperCase() === "INT" ||
          (e.type || "").toUpperCase() === "FLOAT" ||
          (e.type || "").toUpperCase() === "NUMBER";
        const v = values[e.ioKey];
        {/* ── PortRowInt · 数值行 · h=33 严格（Ardot 3:52）───────────────
            单行：Handle 在整行中部 (y_in_row=16.5)，label · spacer · 数字
            输入 · SeedModeButton · chip 行末。chip 永在所有控件之后，与
            Card pr=14 边距对齐——STRING/INT/FLOAT/NUMBER chip 统一右对齐。*/}
        if (numericType && e.control !== "textarea" && e.control !== "image") {
          const b = numericBounds(e);
          const isSeed = isSeedLike(e);
          const isDragging = onReorder && draggingKey === e.ioKey;
          const isDropTarget = onReorder && dragOverKey === e.ioKey && draggingKey && draggingKey !== e.ioKey;
          return (
            <div
              key={e.ioKey}
              {...portDrag(e.ioKey)}
              className={`relative flex h-[33px] shrink-0 items-center gap-2.5 pl-[14px] pr-[14px] ${isDragging ? "opacity-50" : ""}`}
            >
              {isDropTarget && (
                <div className="pointer-events-none absolute inset-x-0 -top-px z-10 h-0.5 bg-violet-400 shadow-[0_0_8px_rgba(124,92,252,0.6)]" />
              )}
              <PortHandle
                id={e.ioKey}
                dir="in"
                type={e.type}
                style={{ top: "50%", transform: "translateY(-50%)" }}
              />
              <span
                className="text-[12px] font-medium text-[#EDEDF2]"
                style={{ fontFamily: "'Inter', system-ui, sans-serif" }}
              >
                {label}
              </span>
              <div className="flex-1" />
              {/*
               *  R-ardot92 (2026-08-17): `─ value +` 左右式 stepper 替换原生
               *  <input type="number"> 上下箭头。共享 NumberField 与 AR/CR 行
               *  已经实现的视觉规范（含按动态回弹、disabled 哑光）。
               *
               *  值严格 Number() 化：API-only 导入偶尔会残留字面量字符串
               *  （如 control_after_generate="fixed"/"randomize" 一旦走漏到
               *  numeric 行的 defaultValue，就会像 4-image 里那样原样露出
               *  "fixed"）。这里把 Number("fixed")=NaN || b.min → 1，恰好
               *  落回 steps 的合理起始值。
               */}
              <div className="flex-1">
                <NumberField
                  value={(typeof v === "number" ? v : Number(v)) || b.min}
                  onChange={(n) => set(e.ioKey, n)}
                  min={b.min}
                  max={b.max}
                  step={b.step}
                  decimalPlaces={e.control === "float" ? b.decimalPlaces : 0}
                />
              </div>
              {isSeed && onSeedModeChange && (
                <SeedModeButton
                  mode={seedModes?.[e.ioKey]}
                  onPick={(m) => onSeedModeChange(e.ioKey, m)}
                />
              )}
              <span
                className="inline-flex shrink-0 items-center rounded-[3px] px-1.5 py-0.5 text-[10px] font-semibold"
                style={{ fontFamily: "'Inter', system-ui, sans-serif", ...chipStyle }}
              >
                {normalizeTypeChip(e.type, e.control === "float" ? "FLOAT" : "INT")}
              </span>
            </div>
          );
        }
        {/* ── PortRow · 非数值行 · min-h=86（Ardot 3:40）───────────────
            R-ardot17 (2026-08-14): 解锁 row wrapper 高度——
              · row wrapper h-[86px] overflow-hidden → min-h-[86px]
                （让真实 prompt 多行内容自然撑高，整张 Card 跟随）。
              · control 区 h-[52px] shrink-0 → flex-1 min-h-0
                （在父级 min-h=86 下填满剩余空间；超长内容时 max-h 限
                滚动）。
              · textarea 用原生 `field-sizing: content` 自适应内容高度；
                min-height 28、max-height 120（约 5-6 行）——超出滚动。
              · Handle 圆心 y_in_row=14 不变（subrow 始终锁顶），但
                y_in_card 跟随 row 高度（这是 Ardot "placeholder=1 行" 假
                设自然延伸）。*/}
        return (
          <div
            key={e.ioKey}
            {...portDrag(e.ioKey)}
            className={`relative min-h-[86px] shrink-0 ${onReorder && draggingKey === e.ioKey ? "opacity-50" : ""}`}
          >
            {onReorder && dragOverKey === e.ioKey && draggingKey && draggingKey !== e.ioKey && (
              <div className="pointer-events-none absolute inset-x-0 -top-px z-10 h-0.5 bg-violet-400 shadow-[0_0_8px_rgba(124,92,252,0.6)]" />
            )}
            <PortHandle
              id={e.ioKey}
              dir="in"
              type={e.type}
              style={{ top: 14, transform: "none" }}
            />
            <div className="flex min-h-[86px] flex-col pt-1.5 pb-1.5">
              {/* subrow h=16：label 在左（pl-14 避让 Handle 圆点 -6），
                  chip 在右（pr-14 贴 Card 右内缘）——chip 永远在 subrow 右端。*/}
              <div className="relative flex h-4 shrink-0 items-center justify-between gap-2.5 pl-[14px] pr-[14px]">
                <span
                  className="text-[12px] font-medium text-[#EDEDF2]"
                  style={{ fontFamily: "'Inter', system-ui, sans-serif" }}
                >
                  {label}
                </span>
                <span
                  className="inline-flex shrink-0 items-center rounded-[3px] px-1.5 py-0.5 text-[10px] font-semibold"
                  style={{ fontFamily: "'Inter', system-ui, sans-serif", ...chipStyle }}
                >
                  {e.type}
                </span>
              </div>
              {/* control 区 fill 剩余空间（= row 高度 - pt-1.5 - subrow-16 -
                  mt-1.5 - pb-1.5 = row 高度 - 34）；textarea 自适应高度 min 28
                  / max 120，超长滚动。
                  R-ardot21 (2026-08-14): 外层 wrapper 加 `overflow: hidden
                  min-w-0` 兜底——textarea 的 box 即使 intrinsic content size
                  撑出 wrapper（Chrome `field-sizing:content` 的 width 接管
                  在 R-ardot20 实测不可靠），wrapper 也会视觉裁掉。*/}
              <div className="mt-1.5 flex-1 min-h-0 min-w-0 overflow-hidden pl-[14px] pr-[14px]">
                {e.control === "textarea" && (
                  <AutoResizeTextarea
                    value={typeof v === "string" ? v : ""}
                    placeholder={`输入 ${label}`}
                    onChange={(val) => set(e.ioKey, val)}
                  />
                )}
                {e.control === "text" && (
                  <input
                    value={typeof v === "string" || typeof v === "number" ? String(v) : ""}
                    placeholder={`输入 ${label}`}
                    onChange={(ev) => set(e.ioKey, ev.target.value)}
                    className="nodrag nopan h-full w-full rounded-md bg-[#0F0F14] px-2.5 py-2 text-[11px] text-[#C9C9D6] outline-none placeholder:text-[#5A5A6B]"
                    style={{ fontFamily: "'Inter', system-ui, sans-serif" }}
                  />
                )}
                {e.control === "image" && (
                  <button
                    type="button"
                    disabled={uploading}
                    onClick={() => pickFile(e.ioKey)}
                    className="nodrag nopan inline-flex h-full items-center gap-1.5 rounded-md bg-[#0F0F14] px-2.5 py-1.5 text-[11px] text-[#C9C9D6] transition-colors hover:text-[#EDEDF2]"
                  >
                    {uploading && uploadTarget === e.ioKey
                      ? "上传中…"
                      : typeof v === "string" && v
                        ? `已选：${v}`
                        : `上传 ${label}`}
                  </button>
                )}
              </div>
            </div>
          </div>
        );
      })}

      {/* R-ardot26 (2026-08-14): 双层守卫 — 画布 workflow 节点上不该
       *  显示 `images` 输出行 + 紫圆点 source handle（叶节点不会被接
       *  下游）。即使 L583 props 边界过滤了 `outputs=[]`，这里再加
       *  `showOutputs` 守护未来重构不会被破坏。 */}
      {showOutputs && outputs.length > 0 && (
        <div>
          {outputs.map((o) => {
            /* 2026-08-15: conflict-aware — see ioLabel(). */
            const label = ioLabel(o, [...wireInputs, ...outputs]);
            const chipStyle = portChipStyle(o.type);
            // OutputRow · h=28 严格（Ardot 3:64）。right:-6 Handle 圆心
            // y_in_row=14，文字 "images" 紧贴 chip（chip 永远最右，pr=14
            // 边距对齐），与 PortRow/PortRowInt chip 统一右对齐。
            return (
              <div
                key={o.ioKey}
                {...portDrag(o.ioKey)}
                className={`relative flex h-[28px] shrink-0 items-center gap-2.5 pl-[14px] pr-[14px] ${onReorder && draggingKey === o.ioKey ? "opacity-50" : ""}`}
              >
                {onReorder && dragOverKey === o.ioKey && draggingKey && draggingKey !== o.ioKey && (
                  <div className="pointer-events-none absolute inset-x-0 -top-px z-10 h-0.5 bg-violet-400 shadow-[0_0_8px_rgba(124,92,252,0.6)]" />
                )}
                <PortHandle
                  id={o.ioKey}
                  dir="out"
                  type={o.type}
                  style={{ right: -6, top: "50%", transform: "translateY(-50%)" }}
                />
                <div className="flex-1" />
                <span
                  className="text-[12px] font-medium text-[#EDEDF2]"
                  style={{ fontFamily: "'Inter', system-ui, sans-serif" }}
                >
                  {label}
                </span>
                <span
                  className="inline-flex shrink-0 items-center rounded-[3px] px-1.5 py-0.5 text-[10px] font-semibold"
                  style={{ fontFamily: "'Inter', system-ui, sans-serif", ...chipStyle }}
                >
                  {normalizeTypeChip(o.type)}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Seed modes — ComfyUI `control_after_generate` mapping.  Each entry has the
 *  ComfyUI value, the Chinese label, and a two-line description used in the
 *  popover (mirrors the Ardot "控件后行为" 4-option panel). */
const SEED_MODES: { value: string; label: string; hint: string }[] = [
  { value: "fixed", label: "固定值", hint: "数值不变" },
  { value: "increment", label: "递增值", hint: "数值+1 或切换到下一个选项" },
  { value: "decrement", label: "递减值", hint: "数值-1 或切换到上一个选项" },
  { value: "random", label: "随机值", hint: "每次运行后随机化该值" },
];

/** Seed-like widget input? (KSampler / custom node seed pins). */
function isSeedLike(e: { name: string; label?: string }): boolean {
  return /seed|noise_seed/i.test(`${e.name} ${e.label ?? ""}`);
}

/** Inline glyph for the seed-mode popover (Ardot 4-option panel).
 *  Geometric, no font dependency — drawn with SVG inside a 36×36 box with
 *  the same dark fill as the WorkflowChipRow chips. */
function SeedModeIcon({ value }: { value: string }) {
  // 36x36 viewBox, ~22x22 glyph centered.
  if (value === "fixed") {
    // 📌 Pin (rounded square cap + diagonal stem with dot).
    return (
      <svg width="22" height="22" viewBox="0 0 22 22" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M11 2.5L13.5 7L19 7.5L15 11.5L15.5 18L11 14.5L6.5 18L7 11.5L3 7.5L8.5 7L11 2.5Z" fill="#FF6B6B" />
      </svg>
    );
  }
  if (value === "increment") {
    return (
      <svg width="22" height="22" viewBox="0 0 22 22" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M11 4.5V17.5" stroke="#67E89D" strokeWidth="2.4" strokeLinecap="round" />
        <path d="M6 9.5L11 4.5L16 9.5" stroke="#67E89D" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (value === "decrement") {
    return (
      <svg width="22" height="22" viewBox="0 0 22 22" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M11 17.5V4.5" stroke="#67E89D" strokeWidth="2.4" strokeLinecap="round" />
        <path d="M6 12.5L11 17.5L16 12.5" stroke="#67E89D" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  // random (dice)
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="2.5" y="2.5" width="17" height="17" rx="3.5" fill="#16161C" stroke="#9A9AAD" strokeWidth="1.2" />
      <circle cx="7" cy="7" r="1.4" fill="#EDEDF2" />
      <circle cx="15" cy="7" r="1.4" fill="#EDEDF2" />
      <circle cx="11" cy="11" r="1.4" fill="#EDEDF2" />
      <circle cx="7" cy="15" r="1.4" fill="#EDEDF2" />
      <circle cx="15" cy="15" r="1.4" fill="#EDEDF2" />
    </svg>
  );
}

/** Clickable seed-mode chip (canvas node → inline on numeric/seed row).
 *  Click toggles a 4-option "控件后行为" popover aligned with the Ardot
 *  design (dark card, icon + title + hint, radio dot on the right).  Picking
 *  an option calls `onPick` which the canvas layer writes back to the
 *  node's `seedModes` map.
 *
 *  Z-index fix (R-ardot73-D bug): the previous inline popover lived inside
 *  a React Flow node, which uses `position:absolute+transform:translate3d(...)`
 *  and therefore creates a stacking context. Even with `z-40` the popover was
 *  covered by any other node whose React Flow `zIndex` was raised (selected,
 *  dragging, etc.). We now portal the popover + backdrop into `document.body`
 *  so they live in the root stacking context and can never be hidden by other
 *  flow nodes. Position is recomputed from the trigger's getBoundingClientRect
 *  on open and on viewport/scroll resize. */
function SeedModeButton({
  mode,
  onPick,
}: {
  mode: string | undefined;
  onPick: (m: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const current = SEED_MODES.find((m) => m.value === mode)?.label ?? "固定值";

  const updatePos = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({ top: r.bottom + 6, right: Math.max(8, window.innerWidth - r.right) });
  }, []);

  useEffect(() => {
    if (!open) return;
    updatePos();
    const onScrollOrResize = () => updatePos();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    // capture: true catches scrolls inside any scroll ancestor (incl. R/F Pane)
    window.addEventListener("scroll", onScrollOrResize, true);
    window.addEventListener("resize", onScrollOrResize);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("scroll", onScrollOrResize, true);
      window.removeEventListener("resize", onScrollOrResize);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, updatePos]);

  const trigger = (
    <button
      ref={triggerRef}
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        setOpen((v) => !v);
      }}
      onMouseDown={(e) => e.stopPropagation()}
      className="nodrag nopan flex h-[30px] shrink-0 items-center gap-1 rounded-md border border-[#26262E] bg-[#0F0F14] px-2 text-[11px] font-medium text-[#C9C9D6] transition-colors hover:border-[#7C5CFC]/40 hover:text-[#EDEDF2]"
      title="控件后行为 · CONTROL AFTER GENERATE"
    >
      <span className="truncate">{current}</span>
      <svg
        width="8"
        height="8"
        viewBox="0 0 8 8"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="opacity-70"
      >
        <path d="M1.5 3L4 5.5L6.5 3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );

  if (!open || typeof document === "undefined") return trigger;

  return (
    <>
      {trigger}
      {createPortal(
        <>
          <div
            className="fixed inset-0"
            style={{ zIndex: 9998 }}
            onClick={(e) => {
              e.stopPropagation();
              setOpen(false);
            }}
            onMouseDown={(e) => e.stopPropagation()}
          />
          <div
            className="nodrag nopan fixed w-[280px] overflow-hidden rounded-xl border border-[#26262E] bg-[#16161C] p-3 shadow-2xl shadow-black/60"
            style={{
              zIndex: 9999,
              top: pos?.top ?? -9999,
              right: pos?.right ?? 0,
            }}
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="space-y-0.5">
              <h4 className="text-[12px] font-semibold text-[#EDEDF2]">
                控件后行为 <span className="text-[#9A9AAD]">· CONTROL AFTER GENERATE</span>
              </h4>
              <p className="text-[10.5px] leading-relaxed text-[#9A9AAD]">
                seed / 类似数值 widget 点击数字弹出 4 选 1 切换面板
              </p>
            </div>
            <div className="mt-2.5 space-y-1">
              {SEED_MODES.map((m) => {
                const selected = m.value === mode;
                return (
                  <button
                    key={m.value}
                    type="button"
                    onClick={() => {
                      onPick(m.value);
                      setOpen(false);
                    }}
                    onMouseDown={(e) => e.stopPropagation()}
                    className={`nodrag nopan flex w-full items-center gap-2.5 rounded-lg border px-2 py-1.5 text-left transition-colors ${
                      selected
                        ? "border-[#7C5CFC]/40 bg-[#1E1A2E]"
                        : "border-transparent hover:bg-white/[0.04]"
                    }`}
                  >
                    <span
                      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
                        selected ? "bg-[#2A1F4A]" : "bg-[#1E1A2E]"
                      }`}
                    >
                      <SeedModeIcon value={m.value} />
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className={`text-[12px] font-semibold ${selected ? "text-[#EDEDF2]" : "text-[#EDEDF2]"}`}>
                        {m.label}
                      </span>
                      <span className="truncate text-[10.5px] leading-snug text-[#9A9AAD]">
                        {m.hint}
                      </span>
                    </span>
                    <span
                      className={`h-3.5 w-3.5 shrink-0 rounded-full border-2 transition-colors ${
                        selected ? "border-[#7C5CFC] bg-[#7C5CFC]" : "border-[#4D4D59] bg-transparent"
                      }`}
                    >
                      {selected && (
                        <span className="block h-full w-full rounded-full ring-2 ring-[#16161C]" />
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </>,
        document.body
      )}
    </>
  );
}

export default DynamicWorkflowForm;
