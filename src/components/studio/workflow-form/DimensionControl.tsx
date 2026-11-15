"use client";
/* Dimension 组合控件入口与 W/H 形态（另见 AspectMegapixelControl.tsx）。两类尺寸：比例 + 分辨率
 * （1k/2k/4k 查场景表）/ 比例 + 百万像素 + 倍数（8/16/32/64）。写入口不同：width+height 由档位算宽高（本文件），
 * aspect_ratio+megapixels(+multiple) 直写；megapixels 是 FLOAT 连续量，故另配 MegapixelStepper 可填 2.5 这类值。 */

import { useCallback, useMemo, useState } from "react";

import { NumberField } from "~/components/ui/number-field";
import { readStorageJson, writeStorageItem } from "~/lib/browser-storage";
import {
  CLARITY_SUBGROUP_OF_KIND,
  DEFAULT_ALIGN_MULTIPLE,
  DEFAULT_DIM_CLARITY_PRESET,
  DEFAULT_DIM_RATIO_PRESET,
  DIM_CLARITY_PRESETS,
  DIM_RATIO_PRESETS,
  clarityKindOfLabel,
  clarityPresetFor,
  dimsForRatio,
  normalizeAlignMultiple,
  pickClarityPreset,
} from "../workflow-io";
import {
  ALIGN_MULTIPLE_OPTIONS,
  megapixelLabel,
  megapixelsOf,
  sceneFromMode,
} from "~/lib/media/size-presets";
import {
  MultiSegmentPopover,
  RatioIcon,
  shortRatioLabel,
  type SegmentSection,
} from "~/components/ui/segment-popover";
import { SizePresetTableModal } from "./SizePresetTableModal";
import { MegapixelStepper } from "./MegapixelStepper";
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

/** 入口：按工作流暴露的范式分发。
 *
 * 分发发生在调用任何 hook **之前**，好让两个子控件各自拥有
 * 自己的 hook 集合（React 不允许条件式 hook）。 */
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
  disabled?: boolean;
  group: DimensionGroup;
  /** 多模式作者态：按该模式解析必填。 */
  mode?: string | null;
  /** 画布 / 库内的紧凑版式：控件按内容收窄（`w-fit`），不再占满整行。
   * 与宽版表单的区别**只是宽度**：录入能力、下拉、落点锚点全部一致。 */
  narrow?: boolean;
  onRequiredChange?: (ioKey: string, required: boolean) => void;
  onVisibilityChange?: (ioKey: string, visible: boolean) => void;
  set: (ioKey: string, v: unknown) => void;
  setMany: (patch: Record<string, unknown>) => void;
  values: Record<string, unknown>;
  /** IO 编辑态：按该模式解析可见性。 */
  visibilityMode?: string | null;
  workflowId?: string;
}) {
  if (group.width && group.height) {
    return (
      <DimensionSizeControl
        disabled={disabled}
        group={{ ...group, width: group.width, height: group.height }}
        mode={mode}
        narrow={narrow}
        onRequiredChange={onRequiredChange}
        onVisibilityChange={onVisibilityChange}
        set={set}
        setMany={setMany}
        values={values}
        visibilityMode={visibilityMode}
        workflowId={workflowId}
      />
    );
  }
  if (group.aspect && group.megapixels) {
    return (
      <AspectMegapixelControl
        disabled={disabled}
        group={{ ...group, aspect: group.aspect, megapixels: group.megapixels }}
        mode={mode}
        narrow={narrow}
        onRequiredChange={onRequiredChange}
        onVisibilityChange={onVisibilityChange}
        setMany={setMany}
        values={values}
        visibilityMode={visibilityMode}
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
  disabled?: boolean;
  group: SizeGroup;
  mode?: string | null;
  narrow?: boolean;
  onRequiredChange?: (ioKey: string, required: boolean) => void;
  onVisibilityChange?: (ioKey: string, visible: boolean) => void;
  set: (ioKey: string, v: unknown) => void;
  setMany: (patch: Record<string, unknown>) => void;
  values: Record<string, unknown>;
  visibilityMode?: string | null;
  workflowId?: string;
}) {
  const w0 = Number(values[group.width.ioKey] ?? group.width.defaultValue ?? 1024);
  const h0 = Number(values[group.height.ioKey] ?? group.height.defaultValue ?? 1024);

  /** 场景决定 1k/2k/4k 查哪张表（图片 = AI 出图口径，视频 = 行业标准口径）。
   * 模式码是视频模式（T2V / I2V …）时用视频表。 */
  const scene = sceneFromMode(mode);
  const { table } = useSizePresetTable();
  const [tableOpen, setTableOpen] = useState(false);

  /* 用户钉住的「对齐倍数」，用于百万像素清晰度预设。
   * 按工作流持久化，这样一个 SDXL 图片工作流的面板
   * 不会串到 Wan 视频工作流上。
   * 默认 64（符合用户要求）。 */
  const ALIGN_PREFIX = "comfyapp:wf-align-multiple:v1";
  const [alignMultiple, setAlignMultipleState] = useState<number>(() =>
    /* SSR / 隐私模式 / 坏数据一律回落默认值（§16.2.4.28）。窄化交给
     *`parse`：此前这里要在本地写一遍`Number.parseInt` + 归一化。 */
    readStorageJson(`${ALIGN_PREFIX}:${workflowId ?? "global"}`, DEFAULT_ALIGN_MULTIPLE, (raw) =>
      normalizeAlignMultiple(Number.parseInt(raw, 10)),
    ),
  );
  const setAlignMultiple = useCallback(
    (multiple: number) => {
      const clamped = normalizeAlignMultiple(multiple);
      setAlignMultipleState(clamped);
      /* 存储不可用（配额满 / 隐私模式）非致命，静默 —— 本次会话内仍然生效。 */
      writeStorageItem(`${ALIGN_PREFIX}:${workflowId ?? "global"}`, String(clamped));
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
        Math.abs(preset.ratio - currentRatio) < Math.abs(best.ratio - currentRatio) ? preset : best,
      DEFAULT_DIM_RATIO_PRESET,
    ).label;
  }, [w0, h0]);
  /* 清晰度跨「分辨率 / 百万像素」两类挑选（pickClarityPreset 镜像应用预设的
   *  场景表 + 对齐倍数）。显式挑过的锁进 explicitClarity，好扛过下一轮往返；
   *  手改 W/H（NumberField）清锁，让自动检测重新胜出。 */
  const derivedClarity = useMemo(
    () => pickClarityPreset(w0, h0, alignMultiple, scene, table).label,
    [w0, h0, alignMultiple, scene, table],
  );
  const [explicitClarity, setExplicitClarity] = useState<string | null>(null);
  const clarity = explicitClarity ?? derivedClarity;
  const clarityKind = clarityKindOfLabel(clarity);

  /* 步进器的值：当前宽高的**实际总像素** —— W/H 形态下「百万像素」本来就是从
   * 宽高推出来的那个量，所以起点与屏幕上看到的尺寸一致（选 1k 就是它的实际
   * 0.8M，而不是从 1M 跳一下）。用户改它 → 按同一比例换总像素预算，宽高随之
   * 吸附到倍数网格。 */
  const currentMegapixels = useMemo(() => megapixelsOf({ width: w0, height: h0 }), [w0, h0]);

  const applyPreset = useCallback(
    (rLabel: string, cLabel: string) => {
      const rp =
        DIM_RATIO_PRESETS.find((preset) => preset.label === rLabel) ?? DEFAULT_DIM_RATIO_PRESET;
      /* 含自由百万像素值（`"2.5M"`）：`clarityPresetFor` 认档位表之外的合法值，
       * 直接用`DIM_CLARITY_PRESETS.find` 会把用户填的 2.5 悄悄换成 1k。 */
      const cp = clarityPresetFor(cLabel);
      /* 分辨率档查场景表；百万像素档把用户选的倍数带进去吸附宽高。 */
      const { width, height } = dimsForRatio(rp.ratio, cp, alignMultiple, scene, table);
      setExplicitClarity(cLabel);
      setMany({ [group.width.ioKey]: width, [group.height.ioKey]: height });
    },
    [group, setMany, alignMultiple, scene, table],
  );

  /* 改对齐倍数：当前 W/H 吸附到新网格，并清掉显式清晰度锁让弹层重新检测
   *  最接近的预设（吸附后可能已属另一清晰度桶）；W/H 步进器也跟随，
   *  使 +/- 与吸附网格保持一致。 */
  const handleAlignChange = useCallback(
    (next: number) => {
      const clamped = normalizeAlignMultiple(next);
      setAlignMultiple(clamped);
      const rp =
        DIM_RATIO_PRESETS.find((preset) => preset.label === ratio) ?? DEFAULT_DIM_RATIO_PRESET;
      const cp =
        DIM_CLARITY_PRESETS.find((preset) => preset.label === clarity) ??
        DEFAULT_DIM_CLARITY_PRESET;
      const { width, height } = dimsForRatio(rp.ratio, cp, clamped, scene, table);
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

  const sections: Array<SegmentSection> = useMemo(() => {
    const list: Array<SegmentSection> = [
      {
        label: "比例",
        value: ratio,
        options: DIM_RATIO_PRESETS.map((preset) => ({
          value: preset.label,
          label: shortRatioLabel(preset.label),
          render: <RatioIcon ratio={preset.ratio} />,
        })),
        onChange: (value) => {
          applyPreset(value, clarity);
        },
      },
      {
        label: "像素",
        value: clarity,
        /* 子类分组：「分辨率」（1k/2k/4k，查场景表）与「百万像素」（1M/2M/4M，
         * 总像素预算）各占一行。 */
        options: DIM_CLARITY_PRESETS.map((preset) => ({
          value: preset.label,
          label: preset.label,
          subgroup: CLARITY_SUBGROUP_OF_KIND[preset.kind],
        })),
        onChange: (value) => {
          applyPreset(ratio, value);
        },
        /* 百万像素是连续量：档位之外再给一个能填任意值的步进器（挨着「百万像素」
         * 那一组渲染）。写出去的 label 与档位同形（"2.5M"），`applyPreset` 经
         *`clarityPresetFor` 认出它。 */
        extra: (
          <MegapixelStepper
            disabled={disabled}
            onChange={(megapixels) => {
              applyPreset(ratio, megapixelLabel(megapixels));
            }}
            value={currentMegapixels}
          />
        ),
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
        onChange: (value) => {
          handleAlignChange(Number(value));
        },
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
    currentMegapixels,
    disabled,
  ]);

  return (
    <div className="flex flex-col gap-2.5">
      {/* 比例 + 像素 单段摆在 W/H 上方——既对应「预设 → 推算宽高」的方向，
 又让下方两个 NumberField 紧挨在一起形成紧凑一行。
 窄版（画布节点 / 库内）卡按内容收窄：`w-fit` + 上限，长度跟内容走。 */}
      <div
        className={
          narrow === true
            ? "border-primary/30 bg-primary/4 w-fit max-w-full rounded-lg border p-2"
            : "border-primary/30 bg-primary/4 rounded-lg border p-2.5"
        }
      >
        <div className="flex items-center gap-2">
          <span className="text-primary text-3xs shrink-0 font-semibold tracking-wider uppercase">
            比例 + 像素
          </span>
          <div className={narrow === true ? "w-28 min-w-0" : "min-w-0 flex-1"}>
            <MultiSegmentPopover
              align="right"
              ariaLabel="选择比例与像素"
              footer={
                <SizeTableFooter
                  extra={
                    <span className="text-ink-faint text-3xs">{CLARITY_HINT[clarityKind]}</span>
                  }
                  onOpen={() => {
                    setTableOpen(true);
                  }}
                  scene={scene}
                />
              }
              sections={sections}
              triggerContent={`${shortRatioLabel(ratio)} / ${clarity}${clarityKind === "megapixel" ? ` / ${alignMultiple}` : ""}`}
            />
          </div>
        </div>
        <RequiredChips
          mode={mode}
          onRequiredChange={onRequiredChange}
          onVisibilityChange={onVisibilityChange}
          pins={[group.width, group.height]}
          visibilityMode={visibilityMode}
        />
      </div>

      {/* 宽 + 高 —— 始终可见，样式与其他参数字段一致（NumberField，两列栅格）。
 上方预设经 applyPreset → setMany 写入真实 W/H，这里实时更新；步进器 +/- 遵循
 钉住的对齐倍数，使手动微调落在与百万像素同一张网格上。 */}
      {narrow !== true && (
        <div className="grid grid-cols-2 gap-2">
          <Field label="宽度">
            <NumberField
              disabled={disabled}
              max={GROUPED_SIZE_MAX}
              min={64}
              onChange={handleW}
              step={alignMultiple}
              value={w0}
            />
          </Field>
          <Field label="高度">
            <NumberField
              disabled={disabled}
              max={GROUPED_SIZE_MAX}
              min={64}
              onChange={handleH}
              step={alignMultiple}
              value={h0}
            />
          </Field>
        </div>
      )}

      {tableOpen && (
        <SizePresetTableModal
          onClose={() => {
            setTableOpen(false);
          }}
          scene={scene}
        />
      )}
    </div>
  );
}

export { DimensionControl };
