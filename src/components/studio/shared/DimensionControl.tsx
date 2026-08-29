"use client";
/* Dimension (image) group control — extracted from GroupedControls.tsx (T12).
 * Renders 比例 + 清晰度 popover on top of W/H NumberFields; preset picks
 * write the real width/height back through `setMany`. */
import { useCallback, useMemo, useState } from "react";
import { NumberField } from "@/components/studio/ui/NumberField";
import {
  DEFAULT_ALIGN_MULTIPLE,
  dimsForRatio,
  normalizeAlignMultiple,
  pickClarityPreset,
  DIM_RATIO_PRESETS,
  DIM_CLARITY_PRESETS,
  type DimensionGroup,
} from "./workflow-io";
import { AlignMultipleStepper } from "./AlignMultipleStepper";
import {
  MultiSegmentPopover,
  RatioIcon,
  shortRatioLabel,
  type SegmentSection,
} from "./MultiSegmentPopover";
import { Field } from "./StyleSwitcher";

function DimensionControl({
  group,
  values,
  set,
  setMany,
  disabled,
  workflowId,
}: {
  group: DimensionGroup;
  values: Record<string, unknown>;
  set: (ioKey: string, v: unknown) => void;
  setMany: (patch: Record<string, unknown>) => void;
  disabled?: boolean;
  workflowId?: string;
}) {
  const w0 = Number(values[group.width.ioKey] ?? group.width.defaultValue ?? 1024);
  const h0 = Number(values[group.height.ioKey] ?? group.height.defaultValue ?? 1024);

  /* R-ardot108 (2026-08-17): user-pinned alignment multiple for the
   *  megapixel clearity presets.  Persisted per-workflow so a panel
   *  for an SDXL image workflow doesn't bleed into a Wan video one.
   *  Default 64 (matches the user requirement). */
  const ALIGN_PREFIX = "comfyapp:wf-align-multiple:v1";
  const [alignMultiple, setAlignMultipleState] = useState<number>(() => {
    if (typeof window === "undefined") return DEFAULT_ALIGN_MULTIPLE;
    try {
      const raw = window.localStorage.getItem(
        `${ALIGN_PREFIX}:${workflowId ?? "global"}`
      );
      if (!raw) return DEFAULT_ALIGN_MULTIPLE;
      const parsed = Number.parseInt(raw, 10);
      return normalizeAlignMultiple(parsed);
    } catch {
      return DEFAULT_ALIGN_MULTIPLE;
    }
  });
  const setAlignMultiple = useCallback(
    (multiple: number) => {
      const clamped = normalizeAlignMultiple(multiple);
      setAlignMultipleState(clamped);
      if (typeof window !== "undefined") {
        try {
          window.localStorage.setItem(
            `${ALIGN_PREFIX}:${workflowId ?? "global"}`,
            String(clamped)
          );
        } catch {
          /* storage unavailable — non-fatal */
        }
      }
    },
    [workflowId]
  );

  // Derive the active ratio / clarity presets from the live width+height so
  // the popover always reflects what's actually in the widgets (even after the
  // user types a custom W/H directly), instead of a stale first-mount guess.
  const ratio = useMemo(() => {
    const currentRatio = h0 === 0 ? 1 : w0 / h0;
    return DIM_RATIO_PRESETS.reduce(
      (best, preset) => (Math.abs(preset.ratio - currentRatio) < Math.abs(best.ratio - currentRatio) ? preset : best),
      DIM_RATIO_PRESETS[0]!
    ).label;
  }, [w0, h0]);
  /* R-ardot104 (2026-08-17): clarity preset is now picked across both
   *  kinds ("pixel" long-edge 1k/2k/4k and "megapixel" total 1M/2M/4M) by
   *  `pickClarityPreset`.  We only need the label here (the underlying
   *  preset is rebuilt inside `applyPreset` when the user picks a new
   *  one).
   *
   *  R-ardot107 (2026-08-17): an explicit user-picked clarity is locked
   *  in `explicitClarity` so a click on, e.g., "4M" survives the next
   *  pickClarityPreset round-trip even if the snap-to-8 dims would have
   *  resolved to a different preset under the old relative scoring.
   *  The explicit value is cleared whenever the user manually edits W
   *  or H via NumberField, so the auto-detect still wins after a
   *  hand-typed value. */
  const derivedClarity = useMemo(
    () => pickClarityPreset(w0, h0, alignMultiple).label,
    [w0, h0, alignMultiple]
  );
  const [explicitClarity, setExplicitClarity] = useState<string | null>(null);
  const clarity = explicitClarity ?? derivedClarity;

  const applyPreset = useCallback(
    (rLabel: string, cLabel: string) => {
      const rp = DIM_RATIO_PRESETS.find((preset) => preset.label === rLabel) ?? DIM_RATIO_PRESETS[0];
      const cp =
        DIM_CLARITY_PRESETS.find((preset) => preset.label === cLabel) ?? DIM_CLARITY_PRESETS[0];
      /* R-ardot108 (2026-08-17): pass the user's alignMultiple through
       *  so megapixel presets (1M/2M/4M) snap to the chosen grid. */
      const { width, height } = dimsForRatio(rp!.ratio, cp!, alignMultiple);
      setExplicitClarity(cLabel);
      setMany({ [group.width.ioKey]: width, [group.height.ioKey]: height });
    },
    [group, setMany, alignMultiple]
  );

  /* R-ardot108 (2026-08-17): changing the alignment multiple
   *  re-snaps the current W/H to the new grid and clears the
   *  explicit-clarity lock so the popover re-detects the closest
   *  preset (the snapped dims may now belong to a different
   *  clearity bucket).  Numeric W/H steppers also follow this value
   *  so the +/- buttons feel consistent with the snap grid. */
  const handleAlignChange = useCallback(
    (next: number) => {
      const clamped = normalizeAlignMultiple(next);
      setAlignMultiple(clamped);
      const rp =
        DIM_RATIO_PRESETS.find((preset) => preset.label === ratio) ?? DIM_RATIO_PRESETS[0];
      const cp =
        DIM_CLARITY_PRESETS.find((preset) => preset.label === clarity) ??
        DIM_CLARITY_PRESETS[0];
      const { width, height } = dimsForRatio(rp!.ratio, cp!, clamped);
      setExplicitClarity(null);
      setMany({ [group.width.ioKey]: width, [group.height.ioKey]: height });
    },
    [ratio, clarity, group, setMany, setAlignMultiple]
  );

  const handleW = useCallback(
    (value: number) => {
      setExplicitClarity(null);
      set(group.width.ioKey, value);
    },
    [group, set]
  );
  const handleH = useCallback(
    (value: number) => {
      setExplicitClarity(null);
      set(group.height.ioKey, value);
    },
    [group, set]
  );

  const sections: SegmentSection<string>[] = useMemo(
    () => [
      {
        label: "比例",
        value: ratio,
        options: DIM_RATIO_PRESETS.map((preset) => ({
          value: preset.label,
          label: shortRatioLabel(preset.label),
          render: <RatioIcon ratio={preset.ratio} />,
        })),
        onChange: (value) => applyPreset(value, clarity),
      },
      {
        label: "清晰度",
        value: clarity,
        /* R-ardot104 (2026-08-17): pixel presets carry `subgroup: "像素"`
         *  and megapixel presets carry `subgroup: "百万像素"`, so the
         *  popover renders two stacked rows inside the 清晰度 section. */
        options: DIM_CLARITY_PRESETS.map((preset) => ({
          value: preset.label,
          label: preset.label,
          subgroup: preset.kind === "megapixel" ? "百万像素" : "像素",
        })),
        onChange: (value) => applyPreset(ratio, value),
      },
    ],
    [ratio, clarity, applyPreset]
  );

  return (
    <div className="space-y-2.5">
      {/* R-ardot101: 比例 + 清晰度 单段摆在 W/H 上方——既对应「预设 → 推算
          宽高」的方向，又让下方两个 NumberField 紧挨在一起形成紧凑一行。 */}
      <div className="rounded-lg border border-(--color-accent)/30 bg-(--color-accent)/4 p-2.5">
        <div className="flex items-center gap-2">
          <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wider text-(--color-accent)">
            比例 + 清晰度
          </span>
          <div className="min-w-0 flex-1">
            <MultiSegmentPopover
              ariaLabel="选择比例与清晰度"
              triggerContent={`${shortRatioLabel(ratio)} / ${clarity}`}
              sections={sections}
              align="right"
              /* R-ardot108 (2026-08-17): the alignMultiple stepper
               *  lives at the foot of the popover.  Defaults to 64,
               *  range [8, 128] in steps of 8, persisted per workflow. */
              footer={
                <AlignMultipleStepper
                  value={alignMultiple}
                  onChange={handleAlignChange}
                  disabled={disabled}
                />
              }
            />
          </div>
        </div>
      </div>

      {/* Width + Height — always visible, styled like any other node parameter
          field (NumberField, two-column grid).  Picking a preset in the row
          above writes the real W/H via applyPreset → setMany, so the
          NumberFields below update live.  R-ardot108 (2026-08-17): the
          stepper +/- matches the user-pinned alignMultiple so the manual
          W/H nudge lands on the same grid the megapixel clearity uses. */}
      <div className="grid grid-cols-2 gap-2">
        <Field label="宽度">
          <NumberField
            value={w0}
            min={64}
            max={4096}
            step={alignMultiple}
            disabled={disabled}
            onChange={handleW}
          />
        </Field>
        <Field label="高度">
          <NumberField
            value={h0}
            min={64}
            max={4096}
            step={alignMultiple}
            disabled={disabled}
            onChange={handleH}
          />
        </Field>
      </div>
    </div>
  );
}

export { DimensionControl };
