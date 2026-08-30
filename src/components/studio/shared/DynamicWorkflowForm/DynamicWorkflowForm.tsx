"use client";

import React, { useCallback, useMemo, useRef, useState } from "react";
import { NumberField } from "@/components/studio/ui/NumberField";
import { DarkSelect } from "@/components/studio/ui/DarkSelect";
import { uploadImageFile } from "@/components/studio/project-canvas/canvas-helpers";
import {
  splitWorkflowIO,
  numericBounds,
  ioLabel,
  isInputFilled,
  inferGroups,
  type ControlKind,
  type WorkflowIOMap,
} from "../workflow-io";
import { GroupedControls } from "../GroupedControls";
import { EditableLabel } from "../EditableLabel";
import {
  AutoResizeTextarea,
  isSeedLike,
  normalizeTypeChip,
  PortHandle,
  SeedModeButton,
  WirePortRows,
} from "../WorkflowFormControls";
import { ACCENT, inputCls } from "./constants";
import { SectionHeader } from "./SectionHeader";
import { LoadingSkeleton } from "./sections/LoadingSkeleton";
import { EmptyStateHint } from "./sections/EmptyStateHint";
import { IoEndpointsSection } from "./sections/IoEndpointsSection";

/* ── DynamicWorkflowForm ──
 * Renders the parameter form for a custom ComfyUI workflow strictly from the
 * pins the author exposed in IO-edit mode.  No hard-coded 提示词/CFG/种子 —
 * a workflow that exposes one `text` pin gets exactly one textarea; a
 * workflow that exposes nothing gets an actionable hint instead of a wall of
 * irrelevant fields.
 *
 * Shared by CreatePanel（宽版）and the canvas `workflow` node（compact）. */

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

/** When the backend type is missing/unknown, fall back to a chip that
 *  matches the control we actually render so the badge is honest about
 *  the row's edit semantics (e.g. textarea → STRING instead of INT). */
function controlTypeFallback(control: ControlKind): string {
  switch (control) {
    case "textarea":
    case "text":
    case "select":
      return "STRING";
    case "int":
      return "INT";
    case "float":
      return "FLOAT";
    case "switch":
      return "BOOLEAN";
    case "image":
      return "IMAGE";
    case "link":
      return "*";
    default:
      return "INT";
  }
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
      onDragStart: (ioKey: string) => (event: React.DragEvent<HTMLDivElement>) => {
        setDraggingKey(ioKey);
        setDragOverKey(ioKey);
        /* Required by HTML5 drag — without dataTransfer.setData, Firefox
         *  refuses to actually start the drag.  The payload itself is
         *  ignored; the caller identifies rows by ioKey via state. */
        try {
          event.dataTransfer.setData("text/plain", ioKey);
          event.dataTransfer.effectAllowed = "move";
        } catch {
          /* Some browsers throw on setData outside user gestures; safe to ignore. */
        }
      },
      onDragOver: (ioKey: string) => (event: React.DragEvent<HTMLDivElement>) => {
        if (!draggingKey || draggingKey === ioKey) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
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
      onDrop: (ioKey: string) => (event: React.DragEvent<HTMLDivElement>) => {
        event.preventDefault();
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
      ...widgetInputs.filter((widgetInput) =>
{
        const typeUpper = (widgetInput.type ?? "").toUpperCase();
        return (typeUpper === "INT" || typeUpper === "FLOAT" || typeUpper === "NUMBER") && !groupedKeys.has(widgetInput.ioKey);
      }),
    ],
    [wireInputs, widgetInputs, groupedKeys]
  );
  // 数值类 widget 由 `WirePortRows` 处理；这里只保留非数值 widget。
  // R-ardot98: 命中 group 的非数值 widget 同样剔除（避免与 GroupedControls 重复）。
  const widgetSectionEntries = useMemo(
    () =>
      widgetInputs.filter((widgetInput) =>
{
        const typeUpper = (widgetInput.type ?? "").toUpperCase();
        return typeUpper !== "INT" && typeUpper !== "FLOAT" && typeUpper !== "NUMBER" && !groupedKeys.has(widgetInput.ioKey);
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
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = "";
      if (!file || !uploadTarget) return;
      setUploading(true);
      try {
        const name = await uploadImageFile(file);
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
    return <LoadingSkeleton />;
  }

  /* No curated IO at all → tell the user exactly how to fix it. */
  if (inputs.length === 0 && outputs.length === 0) {
    return <EmptyStateHint emptyHint={emptyHint} />;
  }

  // 紧凑（画布）模式：端口行紧贴，对齐 Ardot 稿（测试节点端口行无间隔）
  const gridCls = compact ? "space-y-0" : "space-y-3";

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
    widgetInput: (typeof widgetInputs)[number],
    opts: { withHandle?: boolean } = {}
  ) => {
    const withHandle = !!opts.withHandle;
    const accent = ACCENT[widgetInput.control];
    /* 2026-08-15: pass `inputs + outputs` so two pins that happen to
     *  resolve to the same label (e.g. both rendered as `image`)
     *  fall back to the raw `name` and stay visually distinguishable. */
    const label = ioLabel(widgetInput, [...inputs, ...outputs]);
    const v = values[widgetInput.ioKey];

    /* Shared sub-row pieces — used in both compact (inline) and wide
     * (label-on-top) layouts so we don't drift between the two. */
    const typeChip = (
      <span
        className="inline-flex shrink-0 items-center rounded-[3px] px-1.5 py-0.5 text-[10px] font-semibold"
        style={{
          fontFamily: "var(--font-sans)",
          background: "var(--color-border-strong)",
          color: "var(--color-ink-muted)",
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
        {normalizeTypeChip(widgetInput.type, controlTypeFallback(widgetInput.control))}
      </span>
    );
    const labelText = (
      <EditableLabel
        label={label}
        title={`${widgetInput.nodeTitle ?? ""} · ${widgetInput.name}`}
        onChange={onLabelChange ? (next: string) => onLabelChange(widgetInput.ioKey, next) : undefined}
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
          widgetInput.required
            ? "已标记为必填，点击切换为可选"
            : "点击将其标记为必填"
        }
        onClick={(ev) => {
          ev.stopPropagation();
          onRequiredChange(widgetInput.ioKey, !widgetInput.required);
        }}
        onMouseDown={(ev) => ev.stopPropagation()}
        className={`nodrag nopan shrink-0 rounded px-1.5 py-px text-[10px] font-medium transition-colors ${
          widgetInput.required
            ? "border border-red-400/40 bg-red-500/15 text-red-300 hover:bg-red-500/25"
            : "border border-white/8 bg-white/2 text-gray-500 hover:bg-white/6 hover:text-gray-300"
        }`}
      >
        {widgetInput.required ? "必填" : "可选"}
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

    if (widgetInput.control === "link") {
      // link-only 类型无可用控件（仍挂 Handle，方便用户连 link 类型数据）
      if (compact) {
        return (
          <div key={widgetInput.ioKey} className="relative">
            {withHandle && <PortHandle id={widgetInput.ioKey} dir="in" type={widgetInput.type} style={{ top: 16, transform: "translateY(-50%)" }} />}
            <div className="px-[14px] pt-1.5">{labelRow}</div>
            <div className="px-[14px] pt-1 pb-1.5">
              <span className="text-[11px] text-gray-500">只接受连线</span>
            </div>
          </div>
        );
      }
      return (
        <div key={widgetInput.ioKey} className="relative">
          {withHandle && <PortHandle id={widgetInput.ioKey} dir="in" type={widgetInput.type} />}
          <div className="flex items-center gap-2 rounded-md bg-(--color-canvas-deep) px-2.5 py-1.5 pl-[14px] pr-[14px]">
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: accent }} />
            <span className="min-w-0 flex-1 truncate text-[11px] text-(--color-ink-soft)">{label}</span>
            <span
              className="inline-flex shrink-0 items-center rounded-[3px] px-1.5 py-0.5 text-[10px] font-semibold"
              style={{ fontFamily: "var(--font-sans)", background: "var(--color-border-strong)", color: "var(--color-ink-muted)" }}
            >
              {widgetInput.type}
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
      switch (widgetInput.control) {
        case "textarea":
          if (compact) {
            return (
              <AutoResizeTextarea
                key={keyPrefix}
                value={typeof v === "string" ? v : ""}
                placeholder={`输入 ${label}${widgetInput.required ? "（必填）" : ""}`}
                onChange={(value) => set(widgetInput.ioKey, value)}
                minHeight={28}
                maxHeight={80}
              />
            );
          }
          return (
            <textarea
              key={keyPrefix}
              className={`${inputCls} mt-1.5 min-h-[52px] ${
                widgetInput.required && !isInputFilled(v) ? "ring-1 ring-red-400/50" : ""
              }`}
              rows={compact ? 2 : 4}
              value={typeof v === "string" ? v : ""}
              disabled={disabled}
              placeholder={`输入 ${label}${widgetInput.required ? "（必填）" : ""}`}
              onChange={(ev) => set(widgetInput.ioKey, ev.target.value)}
            />
          );
        case "text":
          return (
            <input
              key={keyPrefix}
              className={`${inputCls} ${compact ? "" : "mt-1"} ${
                widgetInput.required && !isInputFilled(v) ? "border-red-400/50" : ""
              }`}
              value={typeof v === "string" || typeof v === "number" ? String(v) : ""}
              disabled={disabled}
              placeholder={`输入 ${label}${widgetInput.required ? "（必填）" : ""}`}
              onChange={(ev) => set(widgetInput.ioKey, ev.target.value)}
            />
          );
        case "int":
        case "float": {
          const bounds = numericBounds(widgetInput);
          const isSeed = compact && isSeedLike(widgetInput);
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
                    value={typeof v === "number" ? v : Number(v) || bounds.min}
                    onChange={(value) => set(widgetInput.ioKey, value)}
                    min={bounds.min}
                    max={bounds.max}
                    step={bounds.step}
                    decimalPlaces={widgetInput.control === "float" ? bounds.decimalPlaces : 0}
                    disabled={disabled}
                  />
                </div>
                {isSeed && (
                  <SeedModeButton
                    mode={seedModes?.[widgetInput.ioKey]}
                    onPick={(mode) => onSeedModeChange?.(widgetInput.ioKey, mode)}
                  />
                )}
              </div>
            );
          }
          return (
            <div key={keyPrefix} className={isSeed ? "mt-1 flex items-center gap-1.5" : "mt-1"}>
              <div className={isSeed ? "flex-1" : undefined}>
                <NumberField
                  value={typeof v === "number" ? v : Number(v) || bounds.min}
                  onChange={(value) => set(widgetInput.ioKey, value)}
                  min={bounds.min}
                  max={bounds.max}
                  step={bounds.step}
                  decimalPlaces={widgetInput.control === "float" ? bounds.decimalPlaces : 0}
                  disabled={disabled}
                />
              </div>
              {isSeed && (
                <SeedModeButton
                  mode={seedModes?.[widgetInput.ioKey]}
                  onPick={(mode) => onSeedModeChange?.(widgetInput.ioKey, mode)}
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
                onClick={() => set(widgetInput.ioKey, !v)}
                className={`nodrag nopan flex h-[28px] w-full items-center justify-between rounded-md bg-(--color-canvas-deep) px-2.5 text-[12px] transition-colors ${
                  v ? "text-emerald-200" : "text-(--color-ink-muted)"
                } ${widgetInput.required && !isInputFilled(v) ? "ring-1 ring-red-400/50" : ""}`}
              >
                <span>{v ? "开启" : "关闭"}</span>
                <span
                  className={`relative h-3.5 w-7 rounded-full transition-colors ${
                    v ? "bg-emerald-400/70" : "bg-white/12"
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
              onClick={() => set(widgetInput.ioKey, !v)}
              className={`nodrag nopan mt-1 flex h-[30px] w-full items-center justify-between rounded-md bg-(--color-canvas-deep) px-3 text-[12px] transition-colors ${
                v ? "text-emerald-200" : "text-(--color-ink-muted)"
              } ${widgetInput.required && !isInputFilled(v) ? "ring-1 ring-red-400/50" : ""}`}
            >
              <span>{v ? "开启" : "关闭"}</span>
              <span
                className={`relative h-3.5 w-7 rounded-full transition-colors ${
                  v ? "bg-emerald-400/70" : "bg-white/12"
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
                className={`nodrag nopan inline-flex h-[28px] w-full items-center gap-1.5 rounded-md bg-(--color-canvas-deep) px-2.5 text-[11px] text-(--color-ink-soft) transition-colors hover:text-(--color-ink-bright) ${
                  widgetInput.required && !isInputFilled(v) ? "ring-1 ring-red-400/50" : ""
                }`}
                disabled={disabled || uploading}
                onClick={() => pickFile(widgetInput.ioKey)}
              >
                {uploading && uploadTarget === widgetInput.ioKey
                  ? "上传中…"
                  : typeof v === "string" && v
                    ? `已选：${v}`
                    : `上传 ${label}${widgetInput.required ? "（必填）" : ""}`}
              </button>
            );
          }
          return (
            <button
              key={keyPrefix}
              type="button"
              className={`nodrag nopan mt-1 inline-flex items-center gap-1.5 rounded-md bg-(--color-canvas-deep) px-2.5 py-1.5 text-[11px] text-(--color-ink-soft) transition-colors hover:text-(--color-ink-bright) ${
                widgetInput.required && !isInputFilled(v) ? "ring-1 ring-red-400/50" : ""
              }`}
              disabled={disabled || uploading}
              onClick={() => pickFile(widgetInput.ioKey)}
            >
              {uploading && uploadTarget === widgetInput.ioKey
                ? "上传中…"
                : typeof v === "string" && v
                  ? `已选：${v}`
                  : `上传 ${label}${widgetInput.required ? "（必填）" : ""}`}
            </button>
          );
        case "select":
          return (
            <DarkSelect
              key={keyPrefix}
              value={typeof v === "string" ? v : ""}
              onChange={(val) => set(widgetInput.ioKey, val)}
              options={Array.isArray(widgetInput.options) ? widgetInput.options : []}
              disabled={disabled}
              placeholder={`选择 ${label}${widgetInput.required ? "（必填）" : ""}`}
              className={`w-full ${
                widgetInput.required && !isInputFilled(v) ? "ring-1 ring-red-400/50 rounded-md" : ""
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
    <div key={widgetInput.ioKey} className="relative">
      {withHandle && <PortHandle id={widgetInput.ioKey} dir="in" type={widgetInput.type} style={{ top: 16, transform: "translateY(-50%)" }} />}
      {/* block A — label + 类型 badge */}
      <div className="px-[14px] pt-1.5">{labelRow}</div>
      {/* block B — 控件独占一行（h 28 自动 / AutoResize minH 28 maxH 80） */}
      <div className="px-[14px] pt-1 pb-1.5">{renderControl("compact-" + widgetInput.ioKey)}</div>
    </div>
  );
}

    /* Wide 布局：label-on-top + control-below（保持原貌，给 CreatePanel
     *  与 IO-edit 预览面板的较宽场景用）。 */
    return (
      <div key={widgetInput.ioKey} className="relative">
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
        {withHandle && <PortHandle id={widgetInput.ioKey} dir="in" type={widgetInput.type} />}
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

        {widgetInput.control === "textarea" && (
          <textarea
            className={`${inputCls} mt-1.5 min-h-[52px] ${
              widgetInput.required && !isInputFilled(v) ? "ring-1 ring-red-400/50" : ""
            }`}
            rows={4}
            value={typeof v === "string" ? v : ""}
            disabled={disabled}
            placeholder={`输入 ${label}${widgetInput.required ? "（必填）" : ""}`}
            onChange={(ev) => set(widgetInput.ioKey, ev.target.value)}
          />
        )}

        {widgetInput.control === "text" && (
          <input
            className={`${inputCls} mt-1 ${
              widgetInput.required && !isInputFilled(v) ? "border-red-400/50" : ""
            }`}
            value={typeof v === "string" || typeof v === "number" ? String(v) : ""}
            disabled={disabled}
            placeholder={`输入 ${label}${widgetInput.required ? "（必填）" : ""}`}
            onChange={(ev) => set(widgetInput.ioKey, ev.target.value)}
          />
        )}

        {(widgetInput.control === "int" || widgetInput.control === "float") && (
          (() => {
            const bounds = numericBounds(widgetInput);
            const isSeed = compact && isSeedLike(widgetInput);
            return (
              <div className={isSeed ? "mt-1 flex items-center gap-1.5" : "mt-1"}>
                <div className={isSeed ? "flex-1" : undefined}>
                  <NumberField
                    value={typeof v === "number" ? v : Number(v) || bounds.min}
                    onChange={(value) => set(widgetInput.ioKey, value)}
                    min={bounds.min}
                    max={bounds.max}
                    step={bounds.step}
                    decimalPlaces={widgetInput.control === "float" ? bounds.decimalPlaces : 0}
                    disabled={disabled}
                  />
                </div>
                {isSeed && (
                  <SeedModeButton
                    mode={seedModes?.[widgetInput.ioKey]}
                    onPick={(mode) => onSeedModeChange?.(widgetInput.ioKey, mode)}
                  />
                )}
              </div>
            );
          })()
        )}

        {widgetInput.control === "switch" && (
          <button
            type="button"
            disabled={disabled}
            onClick={() => set(widgetInput.ioKey, !v)}
            className={`nodrag nopan mt-1 flex h-[30px] w-full items-center justify-between rounded-md bg-(--color-canvas-deep) px-3 text-[12px] transition-colors ${
              v ? "text-emerald-200" : "text-(--color-ink-muted)"
            } ${widgetInput.required && !isInputFilled(v) ? "ring-1 ring-red-400/50" : ""}`}
          >
            <span>{v ? "开启" : "关闭"}</span>
            <span
              className={`relative h-3.5 w-7 rounded-full transition-colors ${
                v ? "bg-emerald-400/70" : "bg-white/12"
              }`}
            >
              <span
                className="absolute top-0.5 h-2.5 w-2.5 rounded-full bg-white transition-all"
                style={{ left: v ? 14 : 3 }}
              />
            </span>
          </button>
        )}

        {widgetInput.control === "image" && (
          <button
            type="button"
            className={`nodrag nopan mt-1 inline-flex items-center gap-1.5 rounded-md bg-(--color-canvas-deep) px-2.5 py-1.5 text-[11px] text-(--color-ink-soft) transition-colors hover:text-(--color-ink-bright) ${
              widgetInput.required && !isInputFilled(v) ? "ring-1 ring-red-400/50" : ""
            }`}
            disabled={disabled || uploading}
            onClick={() => pickFile(widgetInput.ioKey)}
          >
            {uploading && uploadTarget === widgetInput.ioKey
              ? "上传中…"
              : typeof v === "string" && v
                ? `已选：${v}`
                : `上传 ${label}${widgetInput.required ? "（必填）" : ""}`}
          </button>
        )}

        {widgetInput.control === "select" && (
          <div className="mt-1">
            <DarkSelect
              value={typeof v === "string" ? v : ""}
              onChange={(val) => set(widgetInput.ioKey, val)}
              options={Array.isArray(widgetInput.options) ? widgetInput.options : []}
              disabled={disabled}
              placeholder={`选择 ${label}${widgetInput.required ? "（必填）" : ""}`}
              className={`w-full ${
                widgetInput.required && !isInputFilled(v) ? "ring-1 ring-red-400/50 rounded-md" : ""
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
          {widgetSectionEntries.map((widgetSectionEntry) =>
{
            const isDragging = dragHandlers && draggingKey === widgetSectionEntry.ioKey;
            const isDropTarget = dragHandlers && dragOverKey === widgetSectionEntry.ioKey && draggingKey && draggingKey !== widgetSectionEntry.ioKey;
            const row = renderInputRow(widgetSectionEntry, { withHandle: true } as const);
            if (!dragHandlers) return row;
            return (
              <div
                key={widgetSectionEntry.ioKey}
                draggable
                onDragStart={dragHandlers.onDragStart(widgetSectionEntry.ioKey)}
                onDragOver={dragHandlers.onDragOver(widgetSectionEntry.ioKey)}
                onDragLeave={dragHandlers.onDragLeave(widgetSectionEntry.ioKey)}
                onDrop={dragHandlers.onDrop(widgetSectionEntry.ioKey)}
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
                  className="pointer-events-none absolute right-1 top-1/2 z-5 -translate-y-1/2 select-none text-[10px] leading-[6px] text-white/30"
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
      {(groups.dimension ?? groups.video) && (
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
              onPortDragStart={(key) => {
                setDraggingKey(key);
                setDragOverKey(key);
              }}
              onPortDragEnd={() => {
                setDraggingKey(null);
                setDragOverKey(null);
              }}
            />
          ) : (
            <IoEndpointsSection
              wireInputs={wireInputs}
              inputs={inputs}
              outputs={outputs}
              showOutputs={showOutputs}
            />
          )}
        </>
      )}

      {/* 🔧 可编辑参数 (非 compact) — 留给 CreatePanel 和 IO-edit 的双段头版本。 */}
      {!compact && widgetSectionEntries.length > 0 && (
        <>
          <SectionHeader label="可编辑参数" count={widgetSectionEntries.length} accent="#FF9C5B" />
          {widgetSectionEntries.map((widgetInput, _i) => renderInputRow(widgetInput))}
        </>
      )}
    </div>
  );
}

export default DynamicWorkflowForm;
