"use client";
/* Dimension 组合控件的入口与 W/H 形态（另见 AspectMegapixelControl.tsx）。
 *
 * 两种尺寸类别，同一块控件里都能选：
 *   · 比例 + 分辨率         （1k / 2k / 4k，宽高按场景查「尺寸表」）
 *   · 比例 + 百万像素 + 倍数 （1M / 2M / 4M × 宽高对齐倍数 8/16/32/64）
 * 差别只在于控件把值写到哪些端口上：
 *   · 工作流暴露 width + height  → 由选中的档位算出宽高写回去（本文件）；
 *   · 工作流暴露 aspect_ratio + megapixels (+ multiple) → 直接写这三个值，
 *     选「分辨率」时按尺寸表换算成「百万像素 + 倍数」（AspectMegapixelControl）。
 *
 * 「像素」大类下分「分辨率」与「百万像素」两个子类；「倍数」只在选中百万像素档
 * 时出现 —— 那一档的宽高由总像素预算与对齐倍数共同决定，分辨率档则由表给定。 */

import { useCallback, useMemo, useState } from "react";

import { NumberField } from "~/components/ui/number-field";
import {
  CLARITY_SUBGROUP_OF_KIND,
  DEFAULT_ALIGN_MULTIPLE,
  DIM_CLARITY_PRESETS,
  DIM_RATIO_PRESETS,
  clarityKindOfLabel,
  dimsForRatio,
  normalizeAlignMultiple,
  pickClarityPreset,
} from "../workflow-io";
import {
  ALIGN_MULTIPLE_OPTIONS,
  sceneFromMode,
} from "~/lib/media/size-presets";
import {
  MultiSegmentPopover,
  RatioIcon,
  shortRatioLabel,
  type SegmentSection,
} from "~/components/ui/segment-popover";
import { SizePresetTableModal } from "./SizePresetTableModal";
import { useSizePresetTable } from "./hooks/use-size-preset-table";
import { Field } from "./StyleSwitcher";
import { AspectMegapixelControl } from "./AspectMegapixelControl";
import {
  CLARITY_HINT,
  GROUPED_SIZE_MAX,
  RequiredChips,
  SizeTableFooter,
  type SizeGroup,
} from "./DimensionControlParts";
import type { DimensionGroup } from "../workflow-io";

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
  narrow,
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
  /** 画布 / 库内的紧凑版式：控件按内容收窄（`w-fit`），不再占满整行。
   *  与宽版表单的区别**只是宽度**：录入能力、下拉、落点锚点全部一致。 */
  narrow?: boolean;
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
        narrow={narrow}
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
        narrow={narrow}
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
  narrow,
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
  narrow?: boolean;
  onRequiredChange?: (ioKey: string, required: boolean) => void;
  mode?: string | null;
  visibilityMode?: string | null;
  onVisibilityChange?: (ioKey: string, visible: boolean) => void;
}) {
  const w0 = Number(
    values[group.width.ioKey] ?? group.width.defaultValue ?? 1024,
  );
  const h0 = Number(
    values[group.height.ioKey] ?? group.height.defaultValue ?? 1024,
  );

  /** 场景决定 1k/2k/4k 查哪张表（图片 = AI 出图口径，视频 = 行业标准口径）。
   *  模式码是视频模式（T2V / I2V …）时用视频表。 */
  const scene = sceneFromMode(mode);
  const { table } = useSizePresetTable();
  const [tableOpen, setTableOpen] = useState(false);

  /* user-pinned alignment multiple for the
   *  megapixel clearity presets.  Persisted per-workflow so a panel
   *  for an SDXL image workflow doesn't bleed into a Wan video one.
   *  Default 64 (matches the user requirement). */
  const ALIGN_PREFIX = "comfyapp:wf-align-multiple:v1";
  const [alignMultiple, setAlignMultipleState] = useState<number>(() => {
    if (typeof window === "undefined") return DEFAULT_ALIGN_MULTIPLE;
    try {
      const raw = window.localStorage.getItem(
        `${ALIGN_PREFIX}:${workflowId ?? "global"}`,
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
            String(clamped),
          );
        } catch {
          /* storage unavailable — non-fatal */
        }
      }
    },
    [workflowId],
  );

  // Derive the active ratio / clarity presets from the live width+height so
  // the popover always reflects what's actually in the widgets (even after the
  // user types a custom W/H directly), instead of a stale first-mount guess.
  const ratio = useMemo(() => {
    const currentRatio = h0 === 0 ? 1 : w0 / h0;
    return DIM_RATIO_PRESETS.reduce(
      (best, preset) =>
        Math.abs(preset.ratio - currentRatio) <
        Math.abs(best.ratio - currentRatio)
          ? preset
          : best,
      DIM_RATIO_PRESETS[0]!,
    ).label;
  }, [w0, h0]);
  /* clarity preset is picked across both kinds ("pixel" = 分辨率 1k/2k/4k and
   *  "megapixel" = 1M/2M/4M) by `pickClarityPreset`, which mirrors the same
   *  scene table + align multiple used when applying a preset.
   *
   *  an explicit user-picked clarity is locked in `explicitClarity` so a click
   *  on, e.g., "4M" survives the next pickClarityPreset round-trip.  The lock is
   *  cleared whenever the user manually edits W or H via NumberField, so the
   *  auto-detect still wins after a hand-typed value. */
  const derivedClarity = useMemo(
    () => pickClarityPreset(w0, h0, alignMultiple, scene, table).label,
    [w0, h0, alignMultiple, scene, table],
  );
  const [explicitClarity, setExplicitClarity] = useState<string | null>(null);
  const clarity = explicitClarity ?? derivedClarity;
  const clarityKind = clarityKindOfLabel(clarity);

  const applyPreset = useCallback(
    (rLabel: string, cLabel: string) => {
      const rp =
        DIM_RATIO_PRESETS.find((preset) => preset.label === rLabel) ??
        DIM_RATIO_PRESETS[0];
      const cp =
        DIM_CLARITY_PRESETS.find((preset) => preset.label === cLabel) ??
        DIM_CLARITY_PRESETS[0];
      /* 分辨率档查场景表；百万像素档把用户选的倍数带进去吸附宽高。 */
      const { width, height } = dimsForRatio(
        rp!.ratio,
        cp!,
        alignMultiple,
        scene,
        table,
      );
      setExplicitClarity(cLabel);
      setMany({ [group.width.ioKey]: width, [group.height.ioKey]: height });
    },
    [group, setMany, alignMultiple, scene, table],
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
        DIM_RATIO_PRESETS.find((preset) => preset.label === ratio) ??
        DIM_RATIO_PRESETS[0];
      const cp =
        DIM_CLARITY_PRESETS.find((preset) => preset.label === clarity) ??
        DIM_CLARITY_PRESETS[0];
      const { width, height } = dimsForRatio(
        rp!.ratio,
        cp!,
        clamped,
        scene,
        table,
      );
      setExplicitClarity(null);
      setMany({ [group.width.ioKey]: width, [group.height.ioKey]: height });
    },
    [ratio, clarity, group, setMany, setAlignMultiple, scene, table],
  );

  const handleW = useCallback(
    (value: number) => {
      setExplicitClarity(null);
      set(group.width.ioKey, value);
    },
    [group, set],
  );
  const handleH = useCallback(
    (value: number) => {
      setExplicitClarity(null);
      set(group.height.ioKey, value);
    },
    [group, set],
  );

  const sections: SegmentSection<string>[] = useMemo(() => {
    const list: SegmentSection<string>[] = [
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
        label: "像素",
        value: clarity,
        /* 子类分组：「分辨率」（1k/2k/4k，查场景表）与「百万像素」（1M/2M/4M，
         *  总像素预算）各占一行。 */
        options: DIM_CLARITY_PRESETS.map((preset) => ({
          value: preset.label,
          label: preset.label,
          subgroup: CLARITY_SUBGROUP_OF_KIND[preset.kind],
        })),
        onChange: (value) => applyPreset(ratio, value),
      },
    ];
    /* 倍数只在选中「百万像素」时才有意义（分辨率档的宽高由表给定）。 */
    if (clarityKind === "megapixel") {
      list.push({
        label: "倍数",
        value: String(alignMultiple),
        options: ALIGN_MULTIPLE_OPTIONS.map((option) => ({
          value: String(option),
          label: String(option),
        })),
        onChange: (value) => handleAlignChange(Number(value)),
      });
    }
    return list;
  }, [
    ratio,
    clarity,
    clarityKind,
    alignMultiple,
    applyPreset,
    handleAlignChange,
  ]);

  return (
    <div className="space-y-2.5">
      {/* 比例 + 像素 单段摆在 W/H 上方——既对应「预设 → 推算宽高」的方向，
          又让下方两个 NumberField 紧挨在一起形成紧凑一行。
          窄版（画布节点 / 库内）卡按内容收窄：`w-fit` + 上限，长度跟内容走。 */}
      <div
        className={
          narrow
            ? "border-accent/30 bg-accent/4 w-fit max-w-full rounded-lg border p-2"
            : "border-accent/30 bg-accent/4 rounded-lg border p-2.5"
        }
      >
        <div className="flex items-center gap-2">
          <span className="text-accent shrink-0 text-[10px] font-semibold tracking-wider uppercase">
            比例 + 像素
          </span>
          <div className={narrow ? "w-[112px] min-w-0" : "min-w-0 flex-1"}>
            <MultiSegmentPopover
              ariaLabel="选择比例与像素"
              triggerContent={`${shortRatioLabel(ratio)} / ${clarity}${clarityKind === "megapixel" ? ` / ${alignMultiple}` : ""}`}
              sections={sections}
              align="right"
              footer={
                <SizeTableFooter
                  scene={scene}
                  onOpen={() => setTableOpen(true)}
                  extra={
                    <span className="text-ink-faint text-[10px]">
                      {CLARITY_HINT[clarityKind]}
                    </span>
                  }
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
          NumberFields below update live.  The stepper +/- matches the
          user-pinned alignMultiple so the manual W/H nudge lands on the same
          grid the megapixel clearity uses.
          窄版不画宽高步进器：这两个端口在组合控件里由「比例 + 像素」推算，
          它们各自的落点由这块控件承担（见 GroupedControls 的落点口径），
          同一件事不在两处各放一份录入。 */}
      {!narrow && (
        <div className="grid grid-cols-2 gap-2">
          <Field label="宽度">
            <NumberField
              value={w0}
              min={64}
              max={GROUPED_SIZE_MAX}
              step={alignMultiple}
              disabled={disabled}
              onChange={handleW}
            />
          </Field>
          <Field label="高度">
            <NumberField
              value={h0}
              min={64}
              max={GROUPED_SIZE_MAX}
              step={alignMultiple}
              disabled={disabled}
              onChange={handleH}
            />
          </Field>
        </div>
      )}

      {tableOpen && (
        <SizePresetTableModal
          scene={scene}
          onClose={() => setTableOpen(false)}
        />
      )}
    </div>
  );
}

export { DimensionControl };
