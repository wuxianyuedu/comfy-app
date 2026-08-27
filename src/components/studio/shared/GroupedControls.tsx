"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { NumberField } from "@/components/studio/ui/NumberField";
import { DarkSelect } from "@/components/studio/ui/DarkSelect";
import {
  DEFAULT_ALIGN_MULTIPLE,
  MIN_ALIGN_MULTIPLE,
  MAX_ALIGN_MULTIPLE,
  dimsForRatio,
  normalizeAlignMultiple,
  numericBounds,
  pickClarityPreset,
  DIM_RATIO_PRESETS,
  DIM_CLARITY_PRESETS,
  type DimensionGroup,
  type VideoGroup,
  type EnrichedWidget,
} from "./workflow-io";

/* ─────────────────────────────────────────────────────────────────────────
 * R-ardot98 (2026-08-17): grouped parameter controls.
 *
 * Two "paradigms" per group, switchable from a single dropdown
 * (StyleSwitcher):
 *   • Dimension group (image)  — 分别填写宽高  ⇄  比例 + 清晰度（内部算宽高）
 *   • Video group              — 分别填写      ⇄  时长 + 画质 + 比例
 *
 * Every selection ultimately writes the REAL underlying widget values
 * (width/height/length/aspect/quality) back through `onChange`, so the
 * rest of the pipeline (reconcile → toWorkflowInputsPayload → /api/generate)
 * is untouched.  The chosen paradigm is persisted per-workflow in
 * localStorage so the user's preference sticks across reloads.
 * ───────────────────────────────────────────────────────────────────────── */

export type GroupStyle = "split" | "preset";

const STYLE_PREFIX = "comfyapp:wf-group-style:v1";

function loadGroupStyle(workflowId: string | undefined, groupId: string): GroupStyle {
  if (typeof window === "undefined") return "split";
  try {
    const raw = window.localStorage.getItem(`${STYLE_PREFIX}:${workflowId ?? "global"}:${groupId}`);
    return raw === "preset" ? "preset" : "split";
  } catch {
    return "split";
  }
}

function saveGroupStyle(workflowId: string | undefined, groupId: string, style: GroupStyle) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(`${STYLE_PREFIX}:${workflowId ?? "global"}:${groupId}`, style);
  } catch {
    /* storage unavailable (private mode / quota) — non-fatal */
  }
}

/** Segmented dropdown that flips the active fill paradigm. */
function StyleSwitcher({
  style,
  onChange,
  options,
}: {
  style: GroupStyle;
  onChange: (s: GroupStyle) => void;
  options: { value: GroupStyle; label: string }[];
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="shrink-0 text-[10px] text-gray-500">录入方式</span>
      <DarkSelect
        value={style}
        options={options.map((option) => option.value)}
        labels={Object.fromEntries(options.map((option) => [option.value, option.label]))}
        className="flex-1"
        onChange={(value) => onChange(value as GroupStyle)}
      />
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <span className="text-[10px] text-[#9A9AAD]">{label}</span>
      {children}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
 * R-ardot99 (2026-08-17) redesign: a unified multi-section popover dropdown
 * replaces the previous "two separate DarkSelects" preset UI.  The trigger
 * collapses the current selection into a single summary chip
 * (e.g. `16:9 / 2K`) and clicking it opens a panel with one row per
 * parameter — 比例 (icon row, single-select), 清晰度 (segmented, single-
 * select), 质量 (segmented, single-select, optional).  Each row is
 * single-select within itself but the dropdown as a whole lets the user
 * pick from N sections in one place — hence "multi-select popover".
 *
 * Click-outside-to-close is wired with a mousedown listener that
 * excludes the wrapper ref, so the popover doesn't fight the parent
 * form's own click handlers.
 * ───────────────────────────────────────────────────────────────────────── */

/** Small rectangle that visually mirrors a width/height ratio. */
function RatioIcon({ ratio, className = "" }: { ratio: number; className?: string }) {
  const MAX = 18;
  const width = ratio >= 1 ? MAX : Math.max(4, Math.round(MAX * ratio));
  const height = ratio >= 1 ? Math.max(4, Math.round(MAX / ratio)) : MAX;
  return (
    <span
      aria-hidden
      className={`inline-block rounded-[2px] border-[1.5px] border-current ${className}`}
      style={{ width: `${width}px`, height: `${height}px` }}
    />
  );
}

/** One section inside the multi-segment popover. */
interface SegmentSection<T extends string = string> {
  /** Section header label (uppercase, e.g. "比例"). */
  label: string;
  /** Currently-selected option value (must match one of `options.value`). */
  value: T;
  /** Available choices for this section. */
  options: {
    value: T;
    label: string;
    render?: React.ReactNode;
    /** R-ardot104 (2026-08-17): optional sub-group label.  When two options
     *  carry different `subgroup` strings, the section renders them in
     *  separate rows with a small uppercase label between.  Options without
     *  a subgroup default to a single unlabeled row. */
    subgroup?: string;
  }[];
  /** Called when the user picks a different option in this section. */
  onChange: (value: T) => void;
}

function MultiSegmentPopoverInner({
  triggerContent,
  sections,
  align = "left",
  ariaLabel,
  footer,
}: {
  triggerContent: React.ReactNode;
  sections: SegmentSection<string>[];
  align?: "left" | "right";
  ariaLabel?: string;
  /** R-ardot108 (2026-08-17): optional slot rendered below the sections
   *  inside the popover card.  Used for the megapixel alignment-multiple
   *  stepper (a continuous number control that doesn't fit the
   *  `SegmentSection` shape).  Kept generic so future use-cases (e.g.
   *  video bitrate / fps override) can ride the same plumbing. */
  footer?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  /* R-ardot101 (2026-08-17): when the trigger sits near the bottom of the
   *  viewport (typical for parameter forms at the bottom of a CreatePanel
   *  card), opening the panel downward clips the lower sections against the
   *  form edge.  Measure the space on toggle and flip the panel above the
   *  trigger when there isn't enough room below.  Threshold 360 covers the
   *  dimension panel (比例 + 清晰度) and the video panel (时长 + 画质 + 比例)
   *  with padding. */
  const [openAbove, setOpenAbove] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [open]);

  const handleToggle = () => {
    if (!open && wrapRef.current && typeof window !== "undefined") {
      const rect = wrapRef.current.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom;
      setOpenAbove(spaceBelow < 360);
    }
    setOpen((open) => !open);
  };

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={handleToggle}
        className="nodrag nopan flex w-full items-center gap-2 rounded-lg border border-[#7C5CFC]/35 bg-[#0F0F14] px-3 py-2 text-left text-[12px] text-[#EDEDF2] outline-none transition-colors hover:border-[#7C5CFC]/70 focus:border-[#7C5CFC]/70"
      >
        <span className="flex-1 truncate">{triggerContent}</span>
        <svg
          width="10"
          height="10"
          viewBox="0 0 10 10"
          className={`shrink-0 text-[#9A9AAD] transition-transform ${open ? "rotate-180" : ""}`}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
        >
          <path d="M2 4l3 3 3-5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div
          role="listbox"
          className={`absolute z-50 min-w-[260px] rounded-xl bg-[#14141C]/95 p-3 shadow-2xl shadow-black/50 ring-1 ring-white/[0.08] backdrop-blur-md ${
            openAbove ? "bottom-full mb-1.5" : "top-full mt-1.5"
          } ${
            align === "right" ? "right-0" : "left-0"
          }`}
          onMouseDown={(event) => event.stopPropagation()}
        >
          {sections.map((section, i) => (
            <Section key={section.label + ":" + (section.value ?? "")} section={section} first={i === 0} />
          ))}
          {footer ? <div className="mt-3 border-t border-white/[0.06] pt-3">{footer}</div> : null}
        </div>
      )}
    </div>
  );
}

/* R-ardot107 (2026-08-17): split the inner section renderer out so the
 *  (potentially heavy) subgroup grouping only re-runs when its input
 *  actually changes.  The previous inline `.map` rebuilt the Map and
 *  array on every keystroke in CreatePanel, which combined with the
 *  `onChange` callback recreations made switching presets feel sticky. */
const Section = React.memo(function Section({
  section,
  first,
}: {
  section: SegmentSection<string>;
  first: boolean;
}) {
  const grouped = useMemo(() => {
    const hasSubgroups = section.options.some((option) => option.subgroup);
    if (!hasSubgroups) {
      return [{ key: "_", label: undefined, options: section.options }];
    }
    const order: string[] = [];
    const map = new Map<string, { key: string; label?: string; options: typeof section.options }>();
    for (const option of section.options) {
      const key = option.subgroup ?? "_";
      if (!map.has(key)) {
        order.push(key);
        map.set(key, { key: key, label: option.subgroup, options: [] as typeof section.options });
      }
      map.get(key)!.options.push(option);
    }
    return order.map((key) => map.get(key)!);
  }, [section.options]);

  const onPick = useCallback(
    (value: string) => section.onChange(value),
    [section]
  );

  return (
    <div className={first ? "" : "mt-3"}>
      <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-[#9A9AAD]">
        {section.label}
      </div>
      {grouped.map((group, gi) => (
        <div key={group.key} className={gi > 0 ? "mt-2" : ""}>
          {group.label && (
            <div className="mb-1 text-[9px] uppercase tracking-wider text-[#6E6E80]">
              {group.label}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-1.5">
            {group.options.map((opt) => {
              const selected = opt.value === section.value;
              return (
                <button
                  key={String(opt.value)}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  onClick={() => onPick(opt.value)}
                  className={`nodrag nopan flex min-w-[52px] flex-col items-center gap-1 rounded-md px-1.5 py-1.5 text-[11px] transition-colors ${
                    selected
                      ? "bg-[#7C5CFC]/20 text-[#EDEDF2] ring-1 ring-[#7C5CFC]/55"
                      : "text-[#9A9AAD] hover:bg-white/[0.06] hover:text-[#EDEDF2]"
                  }`}
                >
                  {opt.render}
                  <span>{opt.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
});

/* R-ardot107 (2026-08-17): the popover used to be rebuilt on every parent
 *  re-render even when its `sections` array was referentially the same.
 *  Wrap in React.memo so the click-to-select path no longer pays the cost
 *  of recreating all 6 segment buttons on each CreatePanel re-render. */
const MultiSegmentPopover = React.memo(MultiSegmentPopoverInner);

/** Strip a "16:9 横屏" → "16:9" short label for compact triggers and chips. */
function shortRatioLabel(label: string): string {
  return label.split(/\s+/)[0] ?? label;
}

/* ── Video group presets ──
 * length is frames in ComfyUI video workflows; the labels approximate the
 * duration at ~16fps so the user thinks in seconds, not frame counts. */
const VIDEO_DURATION_PRESETS: { label: string; value: number }[] = [
  { label: "3 秒", value: 48 },
  { label: "5 秒", value: 80 },
  { label: "8 秒", value: 128 },
  { label: "10 秒", value: 160 },
];
const VIDEO_QUALITY_PRESETS: { label: string; value: number }[] = [
  { label: "流畅 480P", value: 480 },
  { label: "标清 720P", value: 720 },
  { label: "高清 1080P", value: 1080 },
  { label: "超清 2K", value: 2048 },
];

/** Map a video length / quality / aspect value to a friendly popover label. */
function videoDurationLabel(value: number): string {
  return VIDEO_DURATION_PRESETS.find((preset) => preset.value === value)?.label ?? `${value} 帧`;
}
function videoQualityLabel(value: number): string {
  return VIDEO_QUALITY_PRESETS.find((preset) => preset.value === value)?.label ?? `${value}P`;
}
function videoAspectLabel(ratio: number): string {
  return shortRatioLabel(
    DIM_RATIO_PRESETS.find((preset) => Math.abs(preset.ratio - ratio) < 0.05)?.label ?? "自定义"
  );
}

type VideoRole = "length" | "aspect" | "quality";

function roleLabel(role: VideoRole): string {
  return role === "length" ? "时长" : role === "aspect" ? "比例" : "画质";
}

/* ─────────────────────────────────────────────────────────────────────────
 * Dimension group
 * ───────────────────────────────────────────────────────────────────────── */

/** R-ardot108 (2026-08-17): a tight −/+ stepper for the megapixel
 *  clearity alignment multiple.  Sits at the foot of the 比例+清晰度
 *  popover, default 64, range [8, 128] in 8-step increments.  Visual
 *  shape mirrors the dark `[─ value +]` stepper used for the W/H
 *  NumberField below the popover. */
const AlignMultipleStepper = React.memo(function AlignMultipleStepper({
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
      <span className="shrink-0 text-[10px] text-[#9A9AAD]">倍数</span>
      <div
        className={`flex flex-1 items-center justify-between rounded-md border border-[#7C5CFC]/35 bg-[#0F0F14] px-2 py-1 ${
          disabled ? "opacity-50" : ""
        }`}
      >
        <button
          type="button"
          aria-label="减小对齐倍数"
          onClick={dec}
          disabled={disabled === true || value <= MIN_ALIGN_MULTIPLE}
          className="nodrag nopan h-6 w-6 rounded text-[#9A9AAD] transition-colors hover:bg-white/[0.06] hover:text-[#EDEDF2] disabled:cursor-not-allowed disabled:opacity-40"
        >
          −
        </button>
        <span
          aria-label={`当前对齐倍数 ${value}`}
          className="min-w-[40px] text-center text-[12px] font-medium tabular-nums text-[#EDEDF2]"
        >
          {value}
        </span>
        <button
          type="button"
          aria-label="增大对齐倍数"
 
          onClick={inc}
          disabled={disabled === true || value >= MAX_ALIGN_MULTIPLE}
          className="nodrag nopan h-6 w-6 rounded text-[#9A9AAD] transition-colors hover:bg-white/[0.06] hover:text-[#EDEDF2] disabled:cursor-not-allowed disabled:opacity-40"
        >
          +
        </button>
      </div>
    </div>
  );
});

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
      <div className="rounded-lg border border-[#FF5CA8]/30 bg-[#FF5CA8]/[0.04] p-2.5">
        <div className="flex items-center gap-2">
          <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wider text-[#FF5CA8]">
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
 * Video group — one friendly field per detected sub-widget.
 * ───────────────────────────────────────────────────────────────────────── */
function VideoField({
  role,
  entry,
  preset,
  values,
  set,
  disabled,
}: {
  role: VideoRole;
  entry: EnrichedWidget;
  preset: boolean;
  values: Record<string, unknown>;
  set: (ioKey: string, v: unknown) => void;
  disabled?: boolean;
}) {
  const current = values[entry.ioKey];
  const label = roleLabel(role);

  // COMBO with resolved candidates → always a select (both paradigms).
  if (entry.control === "select" && Array.isArray(entry.options) && entry.options.length > 0) {
    const opts = entry.options;
    const val = typeof current === "string" && opts.includes(current) ? current : opts[0]!;
    return (
      <Field label={label}>
        <DarkSelect
          value={val}
          options={opts}
          disabled={disabled}
          onChange={(value) => set(entry.ioKey, value)}
        />
      </Field>
    );
  }

  // Preset paradigm → friendly dropdowns writing representative values.
  if (preset) {
    if (role === "length") {
      const presets = VIDEO_DURATION_PRESETS;
      const cur = Number(current ?? entry.defaultValue ?? presets[0]!.value);
      const val = presets.find((preset) => preset.value === cur)?.label ?? presets[0]!.label;
      return (
        <Field label={label}>
          <DarkSelect
            value={val}
            options={presets.map((preset) => preset.label)}
            disabled={disabled}
            onChange={(value) => {
              const preset = presets.find((item) => item.label === value);
              if (preset) set(entry.ioKey, preset.value);
            }}
          />
        </Field>
      );
    }
    if (role === "quality") {
      const presets = VIDEO_QUALITY_PRESETS;
      const cur = Number(current ?? entry.defaultValue ?? presets[0]!.value);
      const val = presets.find((preset) => preset.value === cur)?.label ?? presets[0]!.label;
      return (
        <Field label={label}>
          <DarkSelect
            value={val}
            options={presets.map((preset) => preset.label)}
            disabled={disabled}
            onChange={(value) => {
              const preset = presets.find((item) => item.label === value);
              if (preset) set(entry.ioKey, preset.value);
            }}
          />
        </Field>
      );
    }
    if (role === "aspect") {
      // numeric aspect → ratio presets writing the float ratio
      const presets = DIM_RATIO_PRESETS;
      const cur = Number(current ?? entry.defaultValue ?? presets[0]!.ratio);
      const val = presets.find((preset) => Math.abs(preset.ratio - cur) < 0.05)?.label ?? presets[0]!.label;
      return (
        <Field label={label}>
          <DarkSelect
            value={val}
            options={presets.map((preset) => preset.label)}
            disabled={disabled}
            onChange={(value) => {
              const preset = presets.find((item) => item.label === value);
              if (preset) set(entry.ioKey, preset.ratio);
            }}
          />
        </Field>
      );
    }
  }

  // Split paradigm → native control.
  if (entry.control === "int" || entry.control === "float") {
    const bounds = numericBounds(entry);
    const value = Number(current ?? entry.defaultValue ?? bounds.min);
    return (
      <Field label={label}>
        <NumberField
          value={value}
          min={bounds.min}
          max={bounds.max}
          step={bounds.step}
          decimalPlaces={bounds.decimalPlaces}
          disabled={disabled}
          onChange={(nextValue) => set(entry.ioKey, nextValue)}
        />
      </Field>
    );
  }
  const rawValue = current ?? entry.defaultValue ?? "";
  const str = typeof rawValue === "string" ? rawValue : "";
  return (
    <Field label={label}>
      <input
        value={str}
        disabled={disabled}
        className="nodrag nopan w-full rounded-md bg-[#0F0F14] px-2.5 py-2 text-[11px] text-[#C9C9D6] outline-none focus:ring-1 focus:ring-[#7C5CFC]/40"
        onChange={(event) => set(entry.ioKey, event.target.value)}
      />
    </Field>
  );
}

function VideoControl({
  group,
  values,
  set,
  workflowId,
  disabled,
}: {
  group: VideoGroup;
  values: Record<string, unknown>;
  set: (ioKey: string, v: unknown) => void;
  workflowId?: string;
  disabled?: boolean;
}) {
  const [style, setStyle] = useState<GroupStyle>(() => loadGroupStyle(workflowId, group.groupId));
  const onStyle = (newStyle: GroupStyle) => {
    setStyle(newStyle);
    saveGroupStyle(workflowId, group.groupId, newStyle);
  };

  const entries: { role: VideoRole; entry: EnrichedWidget }[] = [];
  if (group.length) entries.push({ role: "length", entry: group.length });
  if (group.aspect) entries.push({ role: "aspect", entry: group.aspect });
  if (group.quality) entries.push({ role: "quality", entry: group.quality });

  if (style === "split") {
    return (
      <div className="space-y-2">
        <StyleSwitcher
          style={style}
          onChange={onStyle}
          options={[
            { value: "split", label: "分别填写" },
            { value: "preset", label: "时长 + 画质 + 比例" },
          ]}
        />
        <div className="grid grid-cols-1 gap-2">
          {entries.map(({ role, entry }) => (
            <VideoField
              key={entry.ioKey}
              role={role}
              entry={entry}
              preset={false}
              values={values}
              set={set}
              disabled={disabled}
            />
          ))}
        </div>
      </div>
    );
  }

  // Preset paradigm → one unified multi-section popover (参考图风格).
  const sections: SegmentSection<string>[] = entries.map(({ role, entry }) => {
    const cur = values[entry.ioKey];
    if (role === "length") {
      const presets = VIDEO_DURATION_PRESETS;
      const value = Number(cur ?? entry.defaultValue ?? presets[0]!.value);
      return {
        label: "时长",
        value: videoDurationLabel(value),
        options: presets.map((preset) => ({ value: preset.label, label: preset.label })),
        onChange: (lbl: string) => {
          const preset = presets.find((item) => item.label === lbl);
          if (preset) set(entry.ioKey, preset.value);
        },
      };
    }
    if (role === "quality") {
      const presets = VIDEO_QUALITY_PRESETS;
      const value = Number(cur ?? entry.defaultValue ?? presets[0]!.value);
      return {
        label: "画质",
        value: videoQualityLabel(value),
        options: presets.map((preset) => ({ value: preset.label, label: preset.label })),
        onChange: (lbl: string) => {
          const preset = presets.find((item) => item.label === lbl);
          if (preset) set(entry.ioKey, preset.value);
        },
      };
    }
    /* role === "aspect" — a COMBO aspect uses its own options, otherwise a
     *  friendly ratio preset writing the float ratio back into the widget. */
    if (entry.control === "select" && Array.isArray(entry.options) && entry.options.length > 0) {
      const opts = entry.options;
      const val = typeof cur === "string" && opts.includes(cur) ? cur : opts[0]!;
      return {
        label: "比例",
        value: val,
        options: opts.map((option) => ({ value: option, label: option })),
        onChange: (option: string) => set(entry.ioKey, option),
      };
    }
    const presets = DIM_RATIO_PRESETS;
    const value = Number(cur ?? entry.defaultValue ?? presets[0]!.ratio);
    return {
      label: "比例",
      value: videoAspectLabel(value),
      options: presets.map((preset) => ({
        value: preset.label,
        label: shortRatioLabel(preset.label),
        render: <RatioIcon ratio={preset.ratio} />,
      })),
      onChange: (lbl: string) => {
        const preset = presets.find((item) => item.label === lbl);
        if (preset) set(entry.ioKey, preset.ratio);
      },
    };
  });

  const summary = sections.map((section) => section.value).join(" · ");

  return (
    <div className="space-y-2">
      <StyleSwitcher
        style={style}
        onChange={onStyle}
        options={[
          { value: "split", label: "分别填写" },
          { value: "preset", label: "时长 + 画质 + 比例" },
        ]}
      />
      <MultiSegmentPopover triggerContent={summary} ariaLabel="选择时长、画质与比例" sections={sections} />
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
 * Public entry point — renders whichever groups were inferred.
 * ───────────────────────────────────────────────────────────────────────── */
export function GroupedControls({
  dimension,
  video,
  values,
  onChange,
  workflowId,
  compact,
  disabled,
}: {
  dimension: DimensionGroup | null;
  video: VideoGroup | null;
  values: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
  workflowId?: string;
  compact?: boolean;
  disabled?: boolean;
}) {
  if (!dimension && !video) return null;
  const count = (dimension ? 1 : 0) + (video ? 1 : 0);

  const set = (ioKey: string, v: unknown) => onChange({ ...values, [ioKey]: v });
  const setMany = (patch: Record<string, unknown>) => onChange({ ...values, ...patch });

  return (
    <>
      {!compact && (
        <div className="mt-1 flex items-center gap-2 border-t border-white/[0.1] pt-2.5">
          <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: "#FF9C5B" }} />
          <span className="text-[10px] font-semibold uppercase tracking-wider text-[#9A9AAD]">
            组合参数
          </span>
          <span className="rounded-full bg-white/[0.1] px-1.5 py-px font-mono text-[10px] text-gray-400">
            {count}
          </span>
          <div className="flex-1 border-t border-dashed border-white/[0.08]" />
        </div>
      )}
      <div className="space-y-3">
        {dimension && (
          <DimensionControl
            group={dimension}
            values={values}
            set={set}
            setMany={setMany}
            disabled={disabled}
            workflowId={workflowId}
          />
        )}
        {video && (
          <VideoControl
            group={video}
            values={values}
            set={set}
            workflowId={workflowId}
            disabled={disabled}
          />
        )}
      </div>
    </>
  );
}
