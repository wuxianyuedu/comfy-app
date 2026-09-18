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

import { NumberField } from "~/components/studio/ui/NumberField";
import {
  CLARITY_SUBGROUP_OF_KIND,
  DEFAULT_ALIGN_MULTIPLE,
  DIM_CLARITY_PRESETS,
  DIM_RATIO_PRESETS,
  clarityKindOfLabel,
  dimsForRatio,
  normalizeAlignMultiple,
  pickClarityPreset,
} from "./workflow-io";
import {
  ALIGN_MULTIPLE_OPTIONS,
  sceneFromMode,
} from "~/lib/media/size-presets";
import {
  MultiSegmentPopover,
  RatioIcon,
  shortRatioLabel,
  type SegmentSection,
} from "./MultiSegmentPopover";
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
import type { DimensionGroup } from "./workflow-io";

/** 入口：按工作流暴露的范式分发。
 *
 *  分发发生在调用任何 hook **之前**，好让两个子控件各自拥有
 *  自己的 hook 集合（React 不允许条件式 hook）。 */
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

  /* 用户钉住的「对齐倍数」，用于百万像素清晰度预设。
   *  按工作流持久化，这样一个 SDXL 图片工作流的面板
   *  不会串到 Wan 视频工作流上。
   *  默认 64（符合用户要求）。 */
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
          /* 存储不可用 —— 非致命 */
        }
      }
    },
    [workflowId],
  );

  // 由实时 width+height 反推当前比例 / 清晰度预设，
  // 这样弹层始终反映 widget 里真实的取值（即使用户直接手打了
  // 自定义 W/H），而不是首次挂载时的猜测。
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
  /* 清晰度预设跨两种类型挑选（"pixel" = 分辨率 1k/2k/4k；
   *  "megapixel" = 1M/2M/4M），由 `pickClarityPreset` 负责，它镜像了
   *  应用预设时用的同一张场景表 + 对齐倍数。
   *
   *  用户显式挑过的清晰度会锁进 `explicitClarity`，好让点过
   *  例如「4M」之后能扛过下一轮 pickClarityPreset 往返。用户经
   *  NumberField 手动改 W 或 H 时锁会被清掉，
   *  这样手打值之后仍是自动检测胜出。 */
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

  /* 改对齐倍数会把当前 W/H
   *  重新吸附到新网格，并清掉
   *  显式清晰度锁，好让弹层重新检测最接近的
   *  预设（吸附后的尺寸可能已属于另一个
   *  清晰度桶）。数值 W/H 步进器也跟随这个值，
   *  让 +/- 按钮与吸附网格保持一致。 */
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

      {/* 宽 + 高 —— 始终可见，样式与别的节点参数字段一致
          （NumberField，两列栅格）。上面一行里挑一个预设
          会经 applyPreset → setMany 写入真实的 W/H，所以下面的
          NumberField 会实时更新。步进器 +/- 遵循
          用户钉住的对齐倍数，好让手动微调 W/H 落在
          与百万像素清晰度同一张网格上。 */}
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
