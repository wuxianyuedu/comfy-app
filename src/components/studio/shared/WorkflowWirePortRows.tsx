"use client";

import React from "react";
import { ioLabel, numericBounds, type ControlKind, type WorkflowIOEntry } from "./workflow-io";
import { NumberField } from "@/components/studio/ui/NumberField";
import { PortHandle, normalizeTypeChip, portChipStyle } from "./WorkflowPortHandle";
import { AutoResizeTextarea } from "./WorkflowFormTextarea";
import { isSeedLike, SeedModeButton } from "./WorkflowSeedModeButton";

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
                className="text-[14px] font-medium text-(--color-ink-bright)"
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
                className="inline-flex shrink-0 items-center rounded-[3px] px-1.5 py-0.5 text-[12px] font-semibold"
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
                  className="text-[14px] font-medium text-(--color-ink-bright)"
                  style={{ fontFamily: "var(--font-sans)" }}
                >
                  {label}
                </span>
                <span
                  className="inline-flex shrink-0 items-center rounded-[3px] px-1.5 py-0.5 text-[12px] font-semibold"
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
                    className="nodrag nopan h-full w-full rounded-md bg-(--color-canvas-deep) px-2.5 py-2 text-[13px] text-(--color-ink-soft) outline-none placeholder:text-(--color-ink-placeholder)"
                    style={{ fontFamily: "var(--font-sans)" }}
                  />
                )}
                {wireInput.control === "image" && (
                  <button
                    type="button"
                    disabled={uploading}
                    onClick={() => pickFile(wireInput.ioKey)}
                    className="nodrag nopan inline-flex h-full items-center gap-1.5 rounded-md bg-(--color-canvas-deep) px-2.5 py-1.5 text-[13px] text-(--color-ink-soft) transition-colors hover:text-(--color-ink-bright)"
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
                  className="text-[14px] font-medium text-(--color-ink-bright)"
                  style={{ fontFamily: "var(--font-sans)" }}
                >
                  {label}
                </span>
                <span
                  className="inline-flex shrink-0 items-center rounded-[3px] px-1.5 py-0.5 text-[12px] font-semibold"
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
