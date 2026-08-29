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
  ASPECT_RATIO_LABEL_PRESETS,
  MEGAPIXEL_VALUE_PRESETS,
  parseRatioFromLabel,
  type DimensionGroup,
  type EnrichedWidget,
} from "./workflow-io";
import { AlignMultipleStepper } from "./AlignMultipleStepper";
import {
  MultiSegmentPopover,
  RatioIcon,
  shortRatioLabel,
  type SegmentSection,
} from "./MultiSegmentPopover";
import { Field } from "./StyleSwitcher";

/** Dimension group narrowed to its W/H form (the classic 比例+清晰度 picker). */
type SizeGroup = DimensionGroup & { width: EnrichedWidget; height: EnrichedWidget };
/** Dimension group narrowed to its 宽高比 + 百万像素 form (ResolutionSelector). */
type AspectMegaGroup = DimensionGroup & { aspect: EnrichedWidget; megapixels: EnrichedWidget };

/** Entry point: dispatch on which paradigm the workflow exposes.
 *
 *  The dispatch happens BEFORE any hook is called so the two sub-controls
 *  can each own their own hook set (React forbids conditional hooks). */
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
  if (group.width && group.height) {
    return (
      <DimensionSizeControl
        group={{ ...group, width: group.width, height: group.height }}
        values={values}
        set={set}
        setMany={setMany}
        disabled={disabled}
        workflowId={workflowId}
      />
    );
  }
  if (group.aspect && group.megapixels) {
    return (
      <AspectMegapixelControl
        group={{ ...group, aspect: group.aspect, megapixels: group.megapixels }}
        values={values}
        setMany={setMany}
        disabled={disabled}
      />
    );
  }
  return null;
}

function DimensionSizeControl({
  group,
  values,
  set,
  setMany,
  disabled,
  workflowId,
}: {
  group: SizeGroup;
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

/* ─────────────────────────────────────────────────────────────────────────
 * AspectMegapixelControl (2026-08-29)
 *
 * For nodes like `ResolutionSelector` that expose `aspect_ratio` (COMBO of
 * label strings) + `megapixels` (FLOAT, 1 ≈ 1M total pixels) instead of raw
 * width/height.  There's nothing to derive, so the popover writes the two
 * widget values directly.
 *
 * When ComfyUI is reachable the curated pin carries `options`, and we render
 * those verbatim (highlighting still works because we parse the ratio out of
 * each option string).  When it isn't (the type/options are missing from the
 * stored IO map) we fall back to the built-in `ASPECT_RATIO_LABEL_PRESETS`.
 * ───────────────────────────────────────────────────────────────────────── */
function AspectMegapixelControl({
  group,
  values,
  setMany,
  disabled,
}: {
  group: AspectMegaGroup;
  values: Record<string, unknown>;
  setMany: (patch: Record<string, unknown>) => void;
  disabled?: boolean;
}) {
  const { aspect, megapixels } = group;

  const rawAspect = values[aspect.ioKey];
  /* Only primitives are safe to stringify — an object value would render as
   *  "[object Object]" and break the preset reverse-detection below. */
  const currentAspect =
    typeof rawAspect === "string"
      ? rawAspect
      : typeof rawAspect === "number"
        ? String(rawAspect)
        : "";
  const currentMp =
    Number(values[megapixels.ioKey] ?? megapixels.defaultValue ?? 1) || 1;

  /** Candidate chips: the node's own COMBO options when available. */
  const aspectOptions = useMemo((): { value: string; label: string; ratio: number }[] => {
    const source =
      Array.isArray(aspect.options) && aspect.options.length > 0
        ? aspect.options
        : ASPECT_RATIO_LABEL_PRESETS.map((preset) => preset.value);
    return source.map((value) => {
      const known = ASPECT_RATIO_LABEL_PRESETS.find((preset) => preset.value === value);
      if (known) return { value, label: known.label, ratio: known.ratio };
      const ratio = parseRatioFromLabel(value);
      return { value, label: shortRatioLabel(value), ratio: ratio ?? 1 };
    });
  }, [aspect.options]);

  /** Reverse-detect the active chip so a hand-typed value still highlights. */
  const activeAspect = useMemo(() => {
    const exact = aspectOptions.find((option) => option.value === currentAspect);
    if (exact) return exact;
    const ratio = parseRatioFromLabel(currentAspect);
    if (ratio === null) return null;
    return aspectOptions.reduce(
      (best, option) => (Math.abs(option.ratio - ratio) < Math.abs(best.ratio - ratio) ? option : best),
      aspectOptions[0]!
    );
  }, [aspectOptions, currentAspect]);

  const mpLabel = useMemo(() => {
    const hit = MEGAPIXEL_VALUE_PRESETS.find((preset) => Math.abs(preset.value - currentMp) < 0.01);
    return hit?.label ?? `${currentMp}M`;
  }, [currentMp]);

  /* Preserve the workflow's own spelling when the user only changes the
   * megapixel count — writing a preset string into a node that spells the
   * option differently would silently blank the pin. */
  const apply = useCallback(
    (nextAspect: string, nextMp: number) => {
      setMany({ [aspect.ioKey]: nextAspect, [megapixels.ioKey]: nextMp });
    },
    [aspect.ioKey, megapixels.ioKey, setMany]
  );

  const sections: SegmentSection<string>[] = useMemo(
    () => [
      {
        label: "比例",
        value: activeAspect?.value ?? "",
        options: aspectOptions.map((option) => ({
          value: option.value,
          label: option.label,
          render: <RatioIcon ratio={option.ratio} />,
        })),
        onChange: (value) => apply(value, currentMp),
      },
      {
        label: "像素",
        value: mpLabel,
        options: MEGAPIXEL_VALUE_PRESETS.map((preset) => ({
          value: preset.label,
          label: preset.label,
        })),
        onChange: (label) => {
          const preset = MEGAPIXEL_VALUE_PRESETS.find((item) => item.label === label);
          if (!preset) return;
          apply(activeAspect?.value ?? currentAspect ?? ASPECT_RATIO_LABEL_PRESETS[0]!.value, preset.value);
        },
      },
    ],
    [aspectOptions, activeAspect, currentAspect, currentMp, mpLabel, apply]
  );

  return (
    <div className="space-y-2.5">
      <div className="rounded-lg border border-(--color-accent)/30 bg-(--color-accent)/4 p-2.5">
        <div className="flex items-center gap-2">
          <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wider text-(--color-accent)">
            比例 + 像素
          </span>
          <div className="min-w-0 flex-1">
            <MultiSegmentPopover
              ariaLabel="选择比例与像素"
              triggerContent={`${activeAspect?.label ?? "自定义"} / ${mpLabel}`}
              sections={sections}
              align="right"
              disabled={disabled}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

export { DimensionControl };
