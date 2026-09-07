"use client";
/* Dimension (image) group control — extracted from GroupedControls.tsx.
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
  resolveEntryRequired,
  isVisibleInMode,
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
import { Eye, EyeOff } from "lucide-react";

/** Dimension group narrowed to its W/H form (the classic 比例+清晰度 picker). */
type SizeGroup = DimensionGroup & { width: EnrichedWidget; height: EnrichedWidget };
/** Dimension group narrowed to its 宽高比 + 百万像素 (+ 倍数) form (ResolutionSelector). */
type AspectMegaGroup = DimensionGroup & {
  aspect: EnrichedWidget;
  megapixels: EnrichedWidget;
  multiple?: EnrichedWidget;
};

/** 组合参数子 pin 的必填 / 显隐控制：grouped 行替代了各自的独立参数行，
 *  原来的必填/可选徽标与 👁 会跟着消失 —— 在组合卡内按 pin 补回。
 *  仅编辑态（IO 预览多模式作者态）传入回调时渲染。
 *
 *  required / visible 都按当前 mode 解析（resolveEntryRequired /
 *  isVisibleInMode）：IO 预览在模式页签下把必填/显隐写进 `modes[mode]`
 *  覆盖层，这里必须读同源回读，否则点完按钮 UI 不回读、看起来像“无法切换”
 *  （历史根因：原实现直读条目级 `pin.required`，与模式级写入错层）。 */
function RequiredChips({
  pins,
  onRequiredChange,
  mode,
  visibilityMode,
  onVisibilityChange,
}: {
  pins: (EnrichedWidget | undefined)[];
  onRequiredChange?: (ioKey: string, required: boolean) => void;
  /** 多模式作者态：按该模式解析必填（未设模式覆盖时回退条目级）。 */
  mode?: string | null;
  /** IO 编辑态：按该模式解析可见性（undefined 不渲染 👁）。 */
  visibilityMode?: string | null;
  onVisibilityChange?: (ioKey: string, visible: boolean) => void;
}) {
  const live = pins.filter((pin): pin is EnrichedWidget => !!pin);
  const showAny =
    !!onRequiredChange || (!!onVisibilityChange && !!visibilityMode);
  if (!showAny || live.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center justify-end gap-1 pt-1">
      {live.map((pin) => {
        const required = !!resolveEntryRequired(pin, mode);
        const visible =
          visibilityMode == null ? true : isVisibleInMode(pin, visibilityMode);
        return (
          <span
            key={pin.ioKey}
            className="flex items-center gap-1 rounded border border-white/6 bg-black/20 px-1.5 py-0.5"
            data-dimension-pin={pin.ioKey}
          >
            <span
              className="max-w-[80px] truncate text-[10px] text-(--color-ink-soft)"
              title={pin.label ?? pin.name}
            >
              {pin.label ?? pin.name}
            </span>
            {onRequiredChange && (
              <button
                type="button"
                onClick={() => onRequiredChange(pin.ioKey, !required)}
                title={
                  required
                    ? "已标记为必填，点击切换为可选"
                    : "点击将其标记为必填"
                }
                className={`nodrag nopan rounded px-1.5 py-px text-[10px] font-medium transition-colors ${
                  required
                    ? "border border-red-400/40 bg-red-500/15 text-red-300 hover:bg-red-500/25"
                    : "border border-white/8 bg-white/2 text-gray-500 hover:bg-white/6 hover:text-gray-300"
                }`}
              >
                {required ? "必填" : "可选"}
              </button>
            )}
            {onVisibilityChange && visibilityMode && (
              <button
                type="button"
                title={
                  visible
                    ? "该参数在当前模式下已可见，点击隐藏"
                    : "该参数在当前模式下已隐藏，点击恢复显示"
                }
                onClick={() => onVisibilityChange(pin.ioKey, !visible)}
                onMouseDown={(ev) => ev.stopPropagation()}
                className={`nodrag nopan rounded p-0.5 transition-colors ${
                  visible
                    ? "text-gray-300 hover:bg-white/8 hover:text-gray-100"
                    : "text-gray-600 hover:bg-white/8 hover:text-gray-200"
                }`}
              >
                {visible ? <Eye size={11} /> : <EyeOff size={11} />}
              </button>
            )}
          </span>
        );
      })}
    </div>
  );
}

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
  onRequiredChange,
  mode,
  visibilityMode,
  onVisibilityChange,
}: {
  group: DimensionGroup;
  values: Record<string, unknown>;
  set: (ioKey: string, v: unknown) => void;
  setMany: (patch: Record<string, unknown>) => void;
  disabled?: boolean;
  workflowId?: string;
  onRequiredChange?: (ioKey: string, required: boolean) => void;
  /** 多模式作者态：按该模式解析必填。 */
  mode?: string | null;
  /** IO 编辑态：按该模式解析可见性。 */
  visibilityMode?: string | null;
  onVisibilityChange?: (ioKey: string, visible: boolean) => void;
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
        onRequiredChange={onRequiredChange}
        mode={mode}
        visibilityMode={visibilityMode}
        onVisibilityChange={onVisibilityChange}
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
        onRequiredChange={onRequiredChange}
        mode={mode}
        visibilityMode={visibilityMode}
        onVisibilityChange={onVisibilityChange}
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
  onRequiredChange,
  mode,
  visibilityMode,
  onVisibilityChange,
}: {
  group: SizeGroup;
  values: Record<string, unknown>;
  set: (ioKey: string, v: unknown) => void;
  setMany: (patch: Record<string, unknown>) => void;
  disabled?: boolean;
  workflowId?: string;
  onRequiredChange?: (ioKey: string, required: boolean) => void;
  mode?: string | null;
  visibilityMode?: string | null;
  onVisibilityChange?: (ioKey: string, visible: boolean) => void;
}) {
  const w0 = Number(values[group.width.ioKey] ?? group.width.defaultValue ?? 1024);
  const h0 = Number(values[group.height.ioKey] ?? group.height.defaultValue ?? 1024);

  /* user-pinned alignment multiple for the
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
  /* clarity preset is now picked across both
   *  kinds ("pixel" long-edge 1k/2k/4k and "megapixel" total 1M/2M/4M) by
   *  `pickClarityPreset`.  We only need the label here (the underlying
   *  preset is rebuilt inside `applyPreset` when the user picks a new
   *  one).
   *
   *  an explicit user-picked clarity is locked
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
      /* pass the user's alignMultiple through
       *  so megapixel presets (1M/2M/4M) snap to the chosen grid. */
      const { width, height } = dimsForRatio(rp!.ratio, cp!, alignMultiple);
      setExplicitClarity(cLabel);
      setMany({ [group.width.ioKey]: width, [group.height.ioKey]: height });
    },
    [group, setMany, alignMultiple]
  );

  /* changing the alignment multiple
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
        /* pixel presets carry `subgroup: "像素"`
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
      {/* 比例 + 清晰度 单段摆在 W/H 上方——既对应「预设 → 推算
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
              /* the alignMultiple stepper
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
        <RequiredChips
          pins={[group.width, group.height]}
          onRequiredChange={onRequiredChange}
          mode={mode}
          visibilityMode={visibilityMode}
          onVisibilityChange={onVisibilityChange}
        />
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
 * AspectMegapixelControl
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
  onRequiredChange,
  mode,
  visibilityMode,
  onVisibilityChange,
}: {
  group: AspectMegaGroup;
  values: Record<string, unknown>;
  setMany: (patch: Record<string, unknown>) => void;
  disabled?: boolean;
  onRequiredChange?: (ioKey: string, required: boolean) => void;
  mode?: string | null;
  visibilityMode?: string | null;
  onVisibilityChange?: (ioKey: string, visible: boolean) => void;
}) {
  const { aspect, megapixels, multiple } = group;

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

  /* ── 倍数段：像素倍数（对齐网格），跟比例 / 像素并列写进同一个 popover ──
   *  语义是「宽高像素取该值的倍数」（如 8 → 尺寸是 8 的倍数），不是缩放
   *  系数。候选项优先用工作流自己的 options，否则给常用网格 8/16/32/64/128
   *  （与 AlignMultipleStepper 的范围一致）；当前值不在候选里时动态补上。 */
  const currentMultiple = useMemo(() => {
    if (!multiple) return 8;
    const raw = values[multiple.ioKey];
    const n = typeof raw === "number" ? raw : Number(raw);
    return Number.isFinite(n) && n > 0
      ? n
      : typeof multiple.defaultValue === "number" && multiple.defaultValue > 0
        ? multiple.defaultValue
        : 8;
  }, [multiple, values]);

  const multipleOptions = useMemo((): { value: number; label: string }[] => {
    const source =
      multiple && Array.isArray(multiple.options) && multiple.options.length > 0
        ? multiple.options
        : ["8", "16", "32", "64", "128"];
    const parsed = source
      .map((item) => Number(item))
      .filter((n) => Number.isFinite(n) && n > 0);
    if (multiple && !parsed.some((n) => n === currentMultiple)) {
      parsed.push(currentMultiple);
      parsed.sort((a, b) => a - b);
    }
    return parsed.map((n) => ({ value: n, label: String(n) }));
  }, [multiple, currentMultiple]);

  const multipleLabel = useMemo(() => String(currentMultiple), [currentMultiple]);

  /* Preserve the workflow's own spelling when the user only changes the
   * megapixel count — writing a preset string into a node that spells the
   * option differently would silently blank the pin. */
  const apply = useCallback(
    (nextAspect: string, nextMp: number, nextMultiple?: number) => {
      setMany({
        [aspect.ioKey]: nextAspect,
        [megapixels.ioKey]: nextMp,
        ...(multiple && nextMultiple !== undefined
          ? { [multiple.ioKey]: nextMultiple }
          : {}),
      });
    },
    [aspect.ioKey, megapixels.ioKey, multiple, setMany]
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
      ...(multiple
        ? [
            {
              label: "倍数",
              value: multipleLabel,
              options: multipleOptions.map((option) => ({
                value: String(option.value),
                label: option.label,
              })),
              onChange: (label: string) => {
                const hit = multipleOptions.find((option) => option.label === label);
                if (!hit) return;
                apply(
                  activeAspect?.value ?? currentAspect ?? ASPECT_RATIO_LABEL_PRESETS[0]!.value,
                  currentMp,
                  hit.value,
                );
              },
            } satisfies SegmentSection<string>,
          ]
        : []),
    ],
    [aspectOptions, activeAspect, currentAspect, currentMp, mpLabel, apply, multiple, multipleLabel, multipleOptions]
  );

  return (
    <div className="space-y-2.5">
      <div className="rounded-lg border border-(--color-accent)/30 bg-(--color-accent)/4 p-2.5">
        <div className="flex items-center gap-2">
          <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wider text-(--color-accent)">
            比例 + 像素{multiple ? " + 倍数" : ""}
          </span>
          <div className="min-w-0 flex-1">
            <MultiSegmentPopover
              ariaLabel={multiple ? "选择比例、像素与倍数" : "选择比例与像素"}
              triggerContent={`${activeAspect?.label ?? "自定义"} / ${mpLabel}${multiple ? ` / ${multipleLabel}` : ""}`}
              sections={sections}
              align="right"
              disabled={disabled}
            />
          </div>
        </div>
        <RequiredChips
          pins={[aspect, megapixels, multiple]}
          onRequiredChange={onRequiredChange}
          mode={mode}
          visibilityMode={visibilityMode}
          onVisibilityChange={onVisibilityChange}
        />
      </div>
    </div>
  );
}

export { DimensionControl };
