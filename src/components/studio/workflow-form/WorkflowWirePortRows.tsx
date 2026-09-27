"use client";

import { upperToken } from "~/lib/upper-token";
import { textHandler } from "~/lib/form-props";
import React, { useState } from "react";
import {
  ioLabel,
  numericBounds,
  typeDisplay,
  type ControlKind,
  type WorkflowIOEntry,
} from "../workflow-io";
import { Button } from "~/components/ui/button";
import { NumberField } from "~/components/ui/number-field";
import { PortHandle, portChipStyle } from "./WorkflowPortHandle";
import { AutoResizeTextarea } from "./WorkflowFormTextarea";
import { isSeedLike, SeedModeButton } from "~/components/ui/seed-mode-button";
import type { WorkflowIODropPosition } from "../workflow-types";

/** 端口行与 widget 行同一守卫：可编辑控件（输入框 / 下拉 / 按钮）上起手
 * 不发起拖拽 —— 行级 draggable 会劫持文本选择，且从这些控件发起的原生
 * 拖拽经常不触发 drop（只有 dragend），表现成「拖了但顺序没变」。 */
const DRAG_CANCEL_SELECTOR =
  "input, textarea, select, button, [contenteditable]";

/** 画布`workflow` 节点的可连接端口行。连线型输入渲染一个
 * 骑在左边缘的句柄 + 一个卡片体（STRING → 内联 textarea，IMAGE → 上传
 * 按钮，纯连线型 → 只有端口）；输出渲染右对齐的名字
 * 贴着类型章 + 一个骑在右边缘的句柄。
 *
 * v3：Handle 从外层 row wrapper 移到 subrow 内（subrow 加
 *`relative`），让 Handle 圆心 = subrow 50% = subrow 16h 中心 y=8（相对 row）。
 * Ardot H-pos-in y=85 → 圆心 91 = PortRow1 y=77 + subrow 圆心 y_in_row=14 →
 * 与实测一致。字符串行（86h）= subrow 中心；数字行（33h 整行即 subrow）
 * = 16.5 ≈ 17 → 与 Ardot H-seed-in 圆心 265 一致。 */
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
  /** 画布 workflow 节点是叶节点，不会有下游接线；
   * 默认 false（即不展示 output 行）。CreatePanel / IO-edit 预览面板仍
   * 传 true。L583 调用处已按`showOutputs ? outputs : []` 过滤过 props，
   * 这里再加守卫是防御 — 防止 WirePortRows 被重构/被错误复用时偷偷
   * 渲染输出行 + source handle。*/
  showOutputs = false,
  /** 与 widget 行同一套拖拽契约。
   * 只有 IO 编辑预览会传它们；画布其余界面
   * 留 undefined，行保持不可拖。
   * 铺到行的外层 <div> 上 —— 可抓位置是行的不可编辑区域；从输入框 /
   * 下拉 / 按钮上起手会在 dragstart 里被取消（与 widget 行同守卫）。 */
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
  /** 内联渲染在类 seed 的数值行上，好让
   * 用户不离开画布节点就能切 control_after_generate（固定值 / 递增值 / 递减值 / 随机值）。
   * 可选 —— 非画布调用方可以
   * 两个都不传。 */
  seedModes?: Record<string, string>;
  onSeedModeChange?: (ioKey: string, mode: string) => void;
  /** 内部 OutputRow 守卫。 false 时不渲染 outputs 段。 */
  showOutputs?: boolean;
  /** 见 DynamicWorkflowForm。传了就每行端口
   * 都可拖；不传则行渲染时
   * 不带拖拽提示。 */
  draggingKey?: string | null;
  dragOverKey?: string | null;
  onReorder?: (
    fromKey: string,
    targetKey: string | null,
    position: WorkflowIODropPosition,
  ) => void;
  /** 回调，好让父级在被拖的是
   * 端口行时同步它的`draggingKey` 状态。镜像
   * widget 行用的契约（DynamicWorkflowForm 自己的
   * 状态）。可选 —— 省略时端口行拖拽仍可
   * 完成`drop` /`reorder`，只是丢掉活跃行的
   * 高亮。 */
  onPortDragStart?: (ioKey: string) => void;
  onPortDragEnd?: () => void;
}) {
  /* 行级内联处理器 —— 每次渲染都重建，因为它们很小，
   * 且每轮渲染重绑闭包能让`draggingKey` 保持
   * 新鲜，无需在这条热路径上放 useMemo。
   * 拖拽状态住在 DynamicWorkflowForm（父级），好让
   * 高亮在 widget 行与端口行之间一致；我们把
   *`onPortDragStart` /`onPortDragEnd` 回调上抛，好让
   * 父级在某端口行开始 / 结束拖拽时更新它的
   *`draggingKey` setter。 */
  /* 落点位置（指针在目标行的上/下半区）：端口行自己持有 —— 上抛给父级的
   * 只有「拖起 / 放下」这两个时机，位置随每条 dragover 变化，放父级会多余
   * 一趟重渲染。指示线画的位置与 onDrop 收到的 position 同源。 */
  const [portDropPosition, setPortDropPosition] =
    useState<WorkflowIODropPosition>("before");
  const positionOf = (
    e: React.DragEvent<HTMLDivElement>,
  ): WorkflowIODropPosition => {
    const rect = e.currentTarget?.getBoundingClientRect?.();
    if (!rect || rect.height <= 0) return "before";
    return e.clientY < rect.top + rect.height / 2 ? "before" : "after";
  };
  const portDrag = (ioKey: string) => {
    if (!onReorder) return {};
    return {
      draggable: true,
      onDragStart: (e: React.DragEvent<HTMLDivElement>) => {
        /* 输入框 / 下拉 / 按钮上起手不拖（与 widget 行同守卫）。 */
        const target = e.target as HTMLElement | null;
        if (target?.closest?.(DRAG_CANCEL_SELECTOR)) {
          e.preventDefault();
          return;
        }
        try {
          e.dataTransfer.setData("text/plain", ioKey);
          e.dataTransfer.effectAllowed = "move";
        } catch {
          /* 有些浏览器在用户手势之外调 setData 会抛异常；忽略即可。 */
        }
        onPortDragStart?.(ioKey);
      },
      onDragOver: (e: React.DragEvent<HTMLDivElement>) => {
        if (!draggingKey || draggingKey === ioKey) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        const pos = positionOf(e);
        if (portDropPosition !== pos) setPortDropPosition(pos);
      },
      onDrop: (e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        if (!onReorder || !draggingKey || draggingKey === ioKey) return;
        const pos = positionOf(e);
        setPortDropPosition("before");
        onReorder(draggingKey, ioKey, pos);
      },
      onDragEnd: () => {
        setPortDropPosition("before");
        onPortDragEnd?.();
      },
    };
  };
  return (
    <div className="">
      {wireInputs.map((wireInput) => {
        /* 冲突感知 —— 见 workflow-io.ts 的 ioLabel()。 */
        const label = ioLabel(wireInput, [...wireInputs, ...outputs]);
        const chipStyle = portChipStyle(wireInput.type);
        // 数值类（ComfyUI INT/FLOAT/NUMBER）→ 端口行底部用紧凑数字输入，
        // 避免和 text/textarea/image 分支重复触发。
        const numericType =
          upperToken(wireInput.type) === "INT" ||
          upperToken(wireInput.type) === "FLOAT" ||
          upperToken(wireInput.type) === "NUMBER";
        const v = values[wireInput.ioKey];
        {
          /* ── PortRowInt · 数值行 · h=33 严格（Ardot 3:52）───────────────
 单行：Handle 在整行中部 (y_in_row=16.5)，label · spacer · 数字
 输入 · SeedModeButton · chip 行末。chip 永在所有控件之后，与
 Card pr=14 边距对齐——STRING/INT/FLOAT/NUMBER chip 统一右对齐。*/
        }
        if (
          numericType &&
          wireInput.control !== "textarea" &&
          wireInput.control !== "image"
        ) {
          const b = numericBounds(wireInput);
          const isSeed = isSeedLike(wireInput);
          const isDragging = onReorder && draggingKey === wireInput.ioKey;
          const isDropTarget =
            onReorder &&
            dragOverKey === wireInput.ioKey &&
            draggingKey &&
            draggingKey !== wireInput.ioKey;
          return (
            <div
              key={wireInput.ioKey}
              {...portDrag(wireInput.ioKey)}
              className={`relative flex h-[33px] shrink-0 items-center gap-2.5 pr-[14px] pl-[14px] ${isDragging ? "opacity-50" : ""}`}
            >
              {isDropTarget && (
                <div
                  className={`z-base bg-primary pointer-events-none absolute inset-x-0 h-0.5 shadow-[0_0_8px_rgba(124,92,252,0.6)] ${portDropPosition === "before" ? "-top-px" : "-bottom-px"}`}
                />
              )}
              <PortHandle
                id={wireInput.ioKey}
                dir="in"
                type={wireInput.type}
                style={{ top: "50%", transform: "translateY(-50%)" }}
              />
              <span
                className="text-ink-bright text-[14px] font-medium"
                style={{ fontFamily: "var(--font-sans)" }}
              >
                {label}
              </span>
              <div className="flex-1" />
              {/*
               *`─ value +` 左右式 stepper 替换原生
               * <input type="number"> 上下箭头。共享 NumberField 与 AR/CR 行
               * 已经实现的视觉规范（含按动态回弹、disabled 哑光）。
               *
               * 值严格 Number() 化：原件偶尔会残留字面量字符串
               * （如 control_after_generate="fixed"/"randomize" 一旦走漏到
               * numeric 行的 defaultValue，就会像 4-image 里那样原样露出
               *"fixed"）。这里把 Number("fixed")=NaN || b.min → 1，恰好
               * 落回 steps 的合理起始值。
               */}
              <div className="flex-1">
                <NumberField
                  value={(typeof v === "number" ? v : Number(v)) || b.min}
                  onChange={(value) => set(wireInput.ioKey, value)}
                  min={b.min}
                  max={b.max}
                  step={b.step}
                  decimalPlaces={
                    wireInput.control === "float" ? b.decimalPlaces : 0
                  }
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
                {typeDisplay(
                  wireInput.type,
                  wireInput.control === "float" ? "FLOAT" : "INT",
                )}
              </span>
            </div>
          );
        }
        {
          /* ── PortRow · 非数值行 · min-h=86（对应 Ardot 3:40）───────────
 row wrapper 高度在此解锁 ——
 1. row wrapper 由 h-[86px] overflow-hidden → min-h-[86px]
 （让真实 prompt 多行内容自然撑高，整张 Card 跟随）。
 · control 区 h-[52px] shrink-0 → flex-1 min-h-0
 （在父级 min-h=86 下填满剩余空间；超长内容时 max-h 限
 滚动）。
 · textarea 用原生`field-sizing: content` 自适应内容高度；
 min-height 28、max-height 120（约 5-6 行）——超出滚动。
 · Handle 圆心 y_in_row=14 不变（subrow 始终锁顶），但
 y_in_card 跟随 row 高度（这是 Ardot 「placeholder=1 行」假
 设的自然延伸）。*/
        }
        return (
          <div
            key={wireInput.ioKey}
            {...portDrag(wireInput.ioKey)}
            className={`relative min-h-[86px] shrink-0 ${onReorder && draggingKey === wireInput.ioKey ? "opacity-50" : ""}`}
          >
            {onReorder &&
              dragOverKey === wireInput.ioKey &&
              draggingKey &&
              draggingKey !== wireInput.ioKey && (
                <div
                  className={`z-base bg-primary pointer-events-none absolute inset-x-0 h-0.5 shadow-[0_0_8px_rgba(124,92,252,0.6)] ${portDropPosition === "before" ? "-top-px" : "-bottom-px"}`}
                />
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
              <div className="relative flex h-4 shrink-0 items-center justify-between gap-2.5 pr-[14px] pl-[14px]">
                <span
                  className="text-ink-bright text-[14px] font-medium"
                  style={{ fontFamily: "var(--font-sans)" }}
                >
                  {label}
                </span>
                <span
                  className="inline-flex shrink-0 items-center rounded-[3px] px-1.5 py-0.5 text-[12px] font-semibold"
                  style={{ fontFamily: "var(--font-sans)", ...chipStyle }}
                >
                  {typeDisplay(wireInput.type)}
                </span>
              </div>
              {/* control 区 fill 剩余空间（= row 高度 - pt-1.5 - subrow-16 -
 mt-1.5 - pb-1.5 = row 高度 - 34）；textarea 自适应高度 min 28
 / max 120，超长滚动。
 R-ardot21 (2026-08-14): 外层 wrapper 加`overflow: hidden
 min-w-0` 兜底——textarea 的 box 即使 intrinsic content size
 撑出 wrapper（Chrome`field-sizing:content` 的 width 接管
 在 R-ardot20 实测不可靠），wrapper 也会视觉裁掉。*/}
              <div className="mt-1.5 min-h-0 min-w-0 flex-1 overflow-hidden pr-[14px] pl-[14px]">
                {wireInput.control === "textarea" && (
                  <AutoResizeTextarea
                    value={typeof v === "string" ? v : ""}
                    placeholder={`输入 ${label}`}
                    onChange={(val) => set(wireInput.ioKey, val)}
                  />
                )}
                {wireInput.control === "text" && (
                  <input
                    value={
                      typeof v === "string" || typeof v === "number"
                        ? String(v)
                        : ""
                    }
                    placeholder={`输入 ${label}`}
                    onChange={textHandler((value) =>
                      set(wireInput.ioKey, value),
                    )}
                    className="nodrag nopan bg-canvas-deep text-ink-soft placeholder:text-ink-placeholder h-full w-full rounded-md px-2.5 py-2 text-[13px] outline-none"
                    style={{ fontFamily: "var(--font-sans)" }}
                  />
                )}
                {wireInput.control === "image" && (
                  <Button
                    variant="ghost"
                    disabled={uploading}
                    onClick={() => pickFile(wireInput.ioKey)}
                    className="nodrag nopan bg-canvas-deep hover:bg-canvas-deep text-ink-soft hover:text-ink-bright h-full gap-1.5 rounded-md px-2.5 py-1.5 text-[13px]"
                  >
                    {uploading && uploadTarget === wireInput.ioKey
                      ? "上传中…"
                      : typeof v === "string" && v
                        ? `已选：${v}`
                        : `上传 ${label}`}
                  </Button>
                )}
              </div>
            </div>
          </div>
        );
      })}

      {/* 双层守卫 — 画布 workflow 节点上不该
       * 显示`images` 输出行 + 紫圆点 source handle（叶节点不会被接
       * 下游）。即使 L583 props 边界过滤了`outputs=[]`，这里再加
       *`showOutputs` 守护未来重构不会被破坏。 */}
      {showOutputs && outputs.length > 0 && (
        <div>
          {outputs.map((output) => {
            /* 冲突感知 —— 见 ioLabel()。 */
            const label = ioLabel(output, [...wireInputs, ...outputs]);
            const chipStyle = portChipStyle(output.type);
            // OutputRow · h=28 严格（Ardot 3:64）。right:-6 Handle 圆心
            // y_in_row=14，文字"images" 紧贴 chip（chip 永远最右，pr=14
            // 边距对齐），与 PortRow/PortRowInt chip 统一右对齐。
            return (
              <div
                key={output.ioKey}
                {...portDrag(output.ioKey)}
                className={`relative flex h-[28px] shrink-0 items-center gap-2.5 pr-[14px] pl-[14px] ${onReorder && draggingKey === output.ioKey ? "opacity-50" : ""}`}
              >
                {onReorder &&
                  dragOverKey === output.ioKey &&
                  draggingKey &&
                  draggingKey !== output.ioKey && (
                    <div
                      className={`z-base bg-primary pointer-events-none absolute inset-x-0 h-0.5 shadow-[0_0_8px_rgba(124,92,252,0.6)] ${portDropPosition === "before" ? "-top-px" : "-bottom-px"}`}
                    />
                  )}
                <PortHandle
                  id={output.ioKey}
                  dir="out"
                  type={output.type}
                  style={{
                    right: -6,
                    top: "50%",
                    transform: "translateY(-50%)",
                  }}
                />
                <div className="flex-1" />
                <span
                  className="text-ink-bright text-[14px] font-medium"
                  style={{ fontFamily: "var(--font-sans)" }}
                >
                  {label}
                </span>
                <span
                  className="inline-flex shrink-0 items-center rounded-[3px] px-1.5 py-0.5 text-[12px] font-semibold"
                  style={{ fontFamily: "var(--font-sans)", ...chipStyle }}
                >
                  {typeDisplay(output.type)}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
