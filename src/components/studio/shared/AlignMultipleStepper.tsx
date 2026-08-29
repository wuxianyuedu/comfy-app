"use client";
/* Megapixel alignment-multiple stepper — extracted from GroupedControls.tsx (T12). */
import React, { useCallback } from "react";
import {
  MIN_ALIGN_MULTIPLE,
  MAX_ALIGN_MULTIPLE,
} from "./workflow-io";

/** R-ardot108 (2026-08-17): a tight −/+ stepper for the megapixel
 *  clearity alignment multiple.  Sits at the foot of the 比例+清晰度
 *  popover, default 64, range [8, 128] in 8-step increments.  Visual
 *  shape mirrors the dark `[─ value +]` stepper used for the W/H
 *  NumberField below the popover. */
export const AlignMultipleStepper = React.memo(function AlignMultipleStepper({
  value,
  onChange,
  disabled,
}: {
  value: number;
  onChange: (v: number) => void;
  disabled?: boolean;
}) {
  const dec = useCallback(() => {
    if (disabled) return;
    onChange(Math.max(MIN_ALIGN_MULTIPLE, value - 8));
  }, [value, onChange, disabled]);
  const inc = useCallback(() => {
    if (disabled) return;
    onChange(Math.min(MAX_ALIGN_MULTIPLE, value + 8));
  }, [value, onChange, disabled]);
  return (
    <div
      data-testid="align-multiple-stepper"
      className="flex items-center gap-2"
    >
      <span className="shrink-0 text-[10px] text-(--color-ink-muted)">倍数</span>
      <div
        className={`flex flex-1 items-center justify-between rounded-md border border-(--color-primary)/35 bg-(--color-canvas-deep) px-2 py-1 ${
          disabled ? "opacity-50" : ""
        }`}
      >
        <button
          type="button"
          aria-label="减小对齐倍数"
          onClick={dec}
          disabled={disabled === true || value <= MIN_ALIGN_MULTIPLE}
          className="nodrag nopan h-6 w-6 rounded text-(--color-ink-muted) transition-colors hover:bg-white/6 hover:text-(--color-ink-bright) disabled:cursor-not-allowed disabled:opacity-40"
        >
          −
        </button>
        <span
          aria-label={`当前对齐倍数 ${value}`}
          className="min-w-[40px] text-center text-[12px] font-medium tabular-nums text-(--color-ink-bright)"
        >
          {value}
        </span>
        <button
          type="button"
          aria-label="增大对齐倍数"

          onClick={inc}
          disabled={disabled === true || value >= MAX_ALIGN_MULTIPLE}
          className="nodrag nopan h-6 w-6 rounded text-(--color-ink-muted) transition-colors hover:bg-white/6 hover:text-(--color-ink-bright) disabled:cursor-not-allowed disabled:opacity-40"
        >
          +
        </button>
      </div>
    </div>
  );
});
