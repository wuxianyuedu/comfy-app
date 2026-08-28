"use client";

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Handle, Position } from "@xyflow/react";
import { ioLabel, numericBounds, type ControlKind, type WorkflowIOEntry, type WorkflowIOMap } from "./workflow-io";
import { NumberField } from "@/components/studio/ui/NumberField";

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
export function normalizeTypeChip(raw: string | undefined, fallback: "INT" | "FLOAT" = "INT"): string {
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
export function AutoResizeTextarea({
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
        fontFamily: "var(--font-sans)",
        boxSizing: "border-box",
        minHeight,
        maxHeight,
        overflowX: "hidden",
        overflowWrap: "anywhere",
        wordBreak: "break-word",
        scrollbarWidth: "none",
        msOverflowStyle: "none",
      }}
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
export function WirePortRows({
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
      {wireInputs.map((wireInput) =>
{
        /* 2026-08-15: conflict-aware — see ioLabel() in workflow-io.ts. */
        const label = ioLabel(wireInput, [...wireInputs, ...outputs]);
        const chipStyle = portChipStyle(wireInput.type);
        // 数值类（ComfyUI INT/FLOAT/NUMBER）→ 端口行底部用紧凑数字输入，
        // 避免和 text/textarea/image 分支重复触发。
        const numericType =
          (wireInput.type ?? "").toUpperCase() === "INT" ||
          (wireInput.type ?? "").toUpperCase() === "FLOAT" ||
          (wireInput.type ?? "").toUpperCase() === "NUMBER";
        const v = values[wireInput.ioKey];
        {/* ── PortRowInt · 数值行 · h=33 严格（Ardot 3:52）───────────────
            单行：Handle 在整行中部 (y_in_row=16.5)，label · spacer · 数字
            输入 · SeedModeButton · chip 行末。chip 永在所有控件之后，与
            Card pr=14 边距对齐——STRING/INT/FLOAT/NUMBER chip 统一右对齐。*/}
        if (numericType && wireInput.control !== "textarea" && wireInput.control !== "image") {
          const b = numericBounds(wireInput);
          const isSeed = isSeedLike(wireInput);
          const isDragging = onReorder && draggingKey === wireInput.ioKey;
          const isDropTarget = onReorder && dragOverKey === wireInput.ioKey && draggingKey && draggingKey !== wireInput.ioKey;
          return (
            <div
              key={wireInput.ioKey}
              {...portDrag(wireInput.ioKey)}
              className={`relative flex h-[33px] shrink-0 items-center gap-2.5 pl-[14px] pr-[14px] ${isDragging ? "opacity-50" : ""}`}
            >
              {isDropTarget && (
                <div className="pointer-events-none absolute inset-x-0 -top-px z-10 h-0.5 bg-violet-400 shadow-[0_0_8px_rgba(124,92,252,0.6)]" />
              )}
              <PortHandle
                id={wireInput.ioKey}
                dir="in"
                type={wireInput.type}
                style={{ top: "50%", transform: "translateY(-50%)" }}
              />
              <span
                className="text-[12px] font-medium text-[#EDEDF2]"
                style={{ fontFamily: "var(--font-sans)" }}
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
                  onChange={(value) => set(wireInput.ioKey, value)}
                  min={b.min}
                  max={b.max}
                  step={b.step}
                  decimalPlaces={wireInput.control === "float" ? b.decimalPlaces : 0}
                />
              </div>
              {isSeed && onSeedModeChange && (
                <SeedModeButton
                  mode={seedModes?.[wireInput.ioKey]}
                  onPick={(mode) => onSeedModeChange(wireInput.ioKey, mode)}
                />
              )}
              <span
                className="inline-flex shrink-0 items-center rounded-[3px] px-1.5 py-0.5 text-[10px] font-semibold"
                style={{ fontFamily: "var(--font-sans)", ...chipStyle }}
              >
                {normalizeTypeChip(wireInput.type, wireInput.control === "float" ? "FLOAT" : "INT")}
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
            key={wireInput.ioKey}
            {...portDrag(wireInput.ioKey)}
            className={`relative min-h-[86px] shrink-0 ${onReorder && draggingKey === wireInput.ioKey ? "opacity-50" : ""}`}
          >
            {onReorder && dragOverKey === wireInput.ioKey && draggingKey && draggingKey !== wireInput.ioKey && (
              <div className="pointer-events-none absolute inset-x-0 -top-px z-10 h-0.5 bg-violet-400 shadow-[0_0_8px_rgba(124,92,252,0.6)]" />
            )}
            <PortHandle
              id={wireInput.ioKey}
              dir="in"
              type={wireInput.type}
              style={{ top: 14, transform: "none" }}
            />
            <div className="flex min-h-[86px] flex-col pt-1.5 pb-1.5">
              {/* subrow h=16：label 在左（pl-14 避让 Handle 圆点 -6），
                  chip 在右（pr-14 贴 Card 右内缘）——chip 永远在 subrow 右端。*/}
              <div className="relative flex h-4 shrink-0 items-center justify-between gap-2.5 pl-[14px] pr-[14px]">
                <span
                  className="text-[12px] font-medium text-[#EDEDF2]"
                  style={{ fontFamily: "var(--font-sans)" }}
                >
                  {label}
                </span>
                <span
                  className="inline-flex shrink-0 items-center rounded-[3px] px-1.5 py-0.5 text-[10px] font-semibold"
                  style={{ fontFamily: "var(--font-sans)", ...chipStyle }}
                >
                  {wireInput.type}
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
                {wireInput.control === "textarea" && (
                  <AutoResizeTextarea
                    value={typeof v === "string" ? v : ""}
                    placeholder={`输入 ${label}`}
                    onChange={(val) => set(wireInput.ioKey, val)}
                  />
                )}
                {wireInput.control === "text" && (
                  <input
                    value={typeof v === "string" || typeof v === "number" ? String(v) : ""}
                    placeholder={`输入 ${label}`}
                    onChange={(ev) => set(wireInput.ioKey, ev.target.value)}
                    className="nodrag nopan h-full w-full rounded-md bg-[#0F0F14] px-2.5 py-2 text-[11px] text-[#C9C9D6] outline-none placeholder:text-[#5A5A6B]"
                    style={{ fontFamily: "var(--font-sans)" }}
                  />
                )}
                {wireInput.control === "image" && (
                  <button
                    type="button"
                    disabled={uploading}
                    onClick={() => pickFile(wireInput.ioKey)}
                    className="nodrag nopan inline-flex h-full items-center gap-1.5 rounded-md bg-[#0F0F14] px-2.5 py-1.5 text-[11px] text-[#C9C9D6] transition-colors hover:text-[#EDEDF2]"
                  >
                    {uploading && uploadTarget === wireInput.ioKey
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
          {outputs.map((output) =>
{
            /* 2026-08-15: conflict-aware — see ioLabel(). */
            const label = ioLabel(output, [...wireInputs, ...outputs]);
            const chipStyle = portChipStyle(output.type);
            // OutputRow · h=28 严格（Ardot 3:64）。right:-6 Handle 圆心
            // y_in_row=14，文字 "images" 紧贴 chip（chip 永远最右，pr=14
            // 边距对齐），与 PortRow/PortRowInt chip 统一右对齐。
            return (
              <div
                key={output.ioKey}
                {...portDrag(output.ioKey)}
                className={`relative flex h-[28px] shrink-0 items-center gap-2.5 pl-[14px] pr-[14px] ${onReorder && draggingKey === output.ioKey ? "opacity-50" : ""}`}
              >
                {onReorder && dragOverKey === output.ioKey && draggingKey && draggingKey !== output.ioKey && (
                  <div className="pointer-events-none absolute inset-x-0 -top-px z-10 h-0.5 bg-violet-400 shadow-[0_0_8px_rgba(124,92,252,0.6)]" />
                )}
                <PortHandle
                  id={output.ioKey}
                  dir="out"
                  type={output.type}
                  style={{ right: -6, top: "50%", transform: "translateY(-50%)" }}
                />
                <div className="flex-1" />
                <span
                  className="text-[12px] font-medium text-[#EDEDF2]"
                  style={{ fontFamily: "var(--font-sans)" }}
                >
                  {label}
                </span>
                <span
                  className="inline-flex shrink-0 items-center rounded-[3px] px-1.5 py-0.5 text-[10px] font-semibold"
                  style={{ fontFamily: "var(--font-sans)", ...chipStyle }}
                >
                  {normalizeTypeChip(output.type)}
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
export function isSeedLike(e: { name: string; label?: string }): boolean {
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
export function SeedModeButton({
  mode,
  onPick,
}: {
  mode: string | undefined;
  onPick: (m: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const current = SEED_MODES.find((SEED_MODES) => SEED_MODES.value === mode)?.label ?? "固定值";

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
      onClick={(event) => {
        event.stopPropagation();
        setOpen((value) => !value);
      }}
      onMouseDown={(event) => event.stopPropagation()}
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
            onClick={(event) => {
              event.stopPropagation();
              setOpen(false);
            }}
            onMouseDown={(event) => event.stopPropagation()}
          />
          <div
            className="nodrag nopan fixed w-[280px] overflow-hidden rounded-xl border border-[#26262E] bg-[#16161C] p-3 shadow-2xl shadow-black/60"
            style={{
              zIndex: 9999,
              top: pos?.top ?? -9999,
              right: pos?.right ?? 0,
            }}
            onClick={(event) => event.stopPropagation()}
            onMouseDown={(event) => event.stopPropagation()}
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
              {SEED_MODES.map((SEED_MODES) =>
{
                const selected = SEED_MODES.value === mode;
                return (
                  <button
                    key={SEED_MODES.value}
                    type="button"
                    onClick={() => {
                      onPick(SEED_MODES.value);
                      setOpen(false);
                    }}
                    onMouseDown={(event) => event.stopPropagation()}
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
                      <SeedModeIcon value={SEED_MODES.value} />
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className={`text-[12px] font-semibold ${selected ? "text-[#EDEDF2]" : "text-[#EDEDF2]"}`}>
                        {SEED_MODES.label}
                      </span>
                      <span className="truncate text-[10.5px] leading-snug text-[#9A9AAD]">
                        {SEED_MODES.hint}
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

