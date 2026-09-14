"use client";
/* 尺寸组合控件之一：宽高比 + 百万像素 (+ 倍数) 形态（ResolutionSelector 类节点）。
 *
 * 这类节点不暴露 width/height，只暴露 `aspect_ratio`（COMBO，值是形如
 * "16:9 (Widescreen)" 的标签）+ `megapixels`（FLOAT，1 ≈ 1M 总像素），
 * 有的话再加一个宽高对齐倍数端口。因此没有宽高可推算，弹层把值直接写到这几个
 * widget 上。
 *
 * 「像素」一栏同时给两类档位（用户口径）：
 *   · 「分辨率」（1k/2k/4k）：按场景尺寸表算出宽高，再唯一解地换算成
 *     「百万像素 + 倍数」写下去；
 *   · 「百万像素」（1M/2M/4M）：直接写该档位的总像素量，倍数保持不变。
 *
 * When ComfyUI is reachable the curated pin carries `options`, and we render
 * those verbatim (highlighting still works because we parse the ratio out of
 * each option string).  When it isn't (the type/options are missing from the
 * stored IO map) we fall back to the built-in `ASPECT_RATIO_LABEL_PRESETS`. */

import { useCallback, useMemo, useState } from "react";

import {
  ALIGN_MULTIPLE_OPTIONS,
  MEGAPIXEL_TIERS,
  RESOLUTION_TIERS,
  SIZE_SCENE_LABELS,
  alignMultipleOf,
  megapixelsOf,
  resolutionDims,
  sceneFromMode,
  type AlignMultiple,
  type SizeDims,
} from "~/lib/size-presets";
import {
  ASPECT_RATIO_LABEL_PRESETS,
  CLARITY_SUBGROUP_OF_KIND,
  DEFAULT_ALIGN_MULTIPLE,
  DIM_RATIO_PRESETS,
  normalizeAlignMultiple,
  parseRatioFromLabel,
  resolutionTierOfLabel,
  typeDisplay,
  type EnrichedWidget,
} from "./workflow-io";
import {
  MultiSegmentPopover,
  RatioIcon,
  shortRatioLabel,
  type SegmentSection,
} from "./MultiSegmentPopover";
import { SizePresetTableModal } from "./SizePresetTableModal";
import { useSizePresetTable } from "./hooks/use-size-preset-table";
import { PortHandle } from "./WorkflowFormControls";
import {
  RequiredChips,
  SizeTableFooter,
  type AspectMegaGroup,
} from "./DimensionControlParts";

export function AspectMegapixelControl({
  group,
  values,
  setMany,
  disabled,
  narrow,
  onRequiredChange,
  mode,
  visibilityMode,
  onVisibilityChange,
}: {
  group: AspectMegaGroup;
  values: Record<string, unknown>;
  setMany: (patch: Record<string, unknown>) => void;
  disabled?: boolean;
  narrow?: boolean;
  onRequiredChange?: (ioKey: string, required: boolean) => void;
  mode?: string | null;
  visibilityMode?: string | null;
  onVisibilityChange?: (ioKey: string, visible: boolean) => void;
}) {
  const { aspect, megapixels, multiple } = group;

  const scene = sceneFromMode(mode);
  const { table } = useSizePresetTable();
  const [tableOpen, setTableOpen] = useState(false);

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
  const aspectOptions = useMemo((): {
    value: string;
    label: string;
    ratio: number;
  }[] => {
    const source =
      Array.isArray(aspect.options) && aspect.options.length > 0
        ? aspect.options
        : ASPECT_RATIO_LABEL_PRESETS.map((preset) => preset.value);
    return source.map((value) => {
      const known = ASPECT_RATIO_LABEL_PRESETS.find(
        (preset) => preset.value === value,
      );
      if (known) return { value, label: known.label, ratio: known.ratio };
      const ratio = parseRatioFromLabel(value);
      return { value, label: shortRatioLabel(value), ratio: ratio ?? 1 };
    });
  }, [aspect.options]);

  /** Reverse-detect the active chip so a hand-typed value still highlights. */
  const activeAspect = useMemo(() => {
    const exact = aspectOptions.find(
      (option) => option.value === currentAspect,
    );
    if (exact) return exact;
    const ratio = parseRatioFromLabel(currentAspect);
    if (ratio === null) return null;
    return aspectOptions.reduce(
      (best, option) =>
        Math.abs(option.ratio - ratio) < Math.abs(best.ratio - ratio)
          ? option
          : best,
      aspectOptions[0]!,
    );
  }, [aspectOptions, currentAspect]);

  /** 当前比例（用于把「分辨率」档换算成宽高 → 百万像素）。 */
  const activeRatio = useMemo(
    () =>
      activeAspect?.ratio ??
      parseRatioFromLabel(currentAspect) ??
      DIM_RATIO_PRESETS[0]!.ratio,
    [activeAspect, currentAspect],
  );

  /* ── 倍数段：像素倍数（对齐网格），跟比例 / 像素并列写进同一个 popover ──
   *  语义是「宽高像素取该值的倍数」（如 8 → 尺寸是 8 的倍数），不是缩放
   *  系数。候选项优先用工作流自己的 options，否则给 8/16/32/64
   *  （与尺寸表配置里的倍数候选同一份）。当前值不在候选里时动态补上。 */
  const currentMultiple = useMemo(() => {
    if (!multiple) return DEFAULT_ALIGN_MULTIPLE;
    const raw = values[multiple.ioKey];
    const n = typeof raw === "number" ? raw : Number(raw);
    return Number.isFinite(n) && n > 0
      ? normalizeAlignMultiple(n)
      : typeof multiple.defaultValue === "number" && multiple.defaultValue > 0
        ? normalizeAlignMultiple(multiple.defaultValue)
        : DEFAULT_ALIGN_MULTIPLE;
  }, [multiple, values]);

  /** 「像素」一栏的档位：分辨率（查场景表换算）与百万像素（直接给值）两行。 */
  const clarityOptions = useMemo((): {
    label: string;
    subgroup: string;
    megapixels: number;
    multiple: AlignMultiple;
  }[] => {
    const rows: {
      label: string;
      subgroup: string;
      megapixels: number;
      multiple: AlignMultiple;
    }[] = [];
    for (const tier of RESOLUTION_TIERS) {
      const size = resolutionDims(scene, activeRatio, tier, table);
      rows.push({
        label: tier,
        subgroup: CLARITY_SUBGROUP_OF_KIND.resolution,
        megapixels: megapixelsOf(size),
        multiple: alignMultipleOf(size),
      });
    }
    for (const tier of MEGAPIXEL_TIERS) {
      rows.push({
        label: `${tier}M`,
        subgroup: CLARITY_SUBGROUP_OF_KIND.megapixel,
        megapixels: tier,
        multiple: currentMultiple,
      });
    }
    return rows;
  }, [scene, activeRatio, table, currentMultiple]);

  /* 当前 megapixels 值落在哪个档位上：分辨率档按「该档换算出的总像素」比对，
   * 百万像素档按档位数值比对。 */
  const mpLabel = useMemo(() => {
    const hit = clarityOptions.reduce((best, option) =>
      Math.abs(option.megapixels - currentMp) <
      Math.abs(best.megapixels - currentMp)
        ? option
        : best,
    );
    return hit?.label ?? `${currentMp}M`;
  }, [clarityOptions, currentMp]);

  const multipleOptions = useMemo((): { value: number; label: string }[] => {
    const source =
      multiple && Array.isArray(multiple.options) && multiple.options.length > 0
        ? multiple.options
        : ALIGN_MULTIPLE_OPTIONS.map((option) => String(option));
    const parsed = source
      .map((item) => Number(item))
      .filter((n) => Number.isFinite(n) && n > 0);
    if (multiple && !parsed.some((n) => n === currentMultiple)) {
      parsed.push(currentMultiple);
      parsed.sort((a, b) => a - b);
    }
    return parsed.map((n) => ({ value: n, label: String(n) }));
  }, [multiple, currentMultiple]);

  const multipleLabel = useMemo(
    () => String(currentMultiple),
    [currentMultiple],
  );

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
    [aspect.ioKey, megapixels.ioKey, multiple, setMany],
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
        /* 两个子类各占一行：分辨率（1k/2k/4k，按场景表换算）与百万像素（1M/2M/4M）。 */
        options: clarityOptions.map((option) => ({
          value: option.label,
          label: option.label,
          subgroup: option.subgroup,
        })),
        onChange: (label) => {
          const preset = clarityOptions.find((item) => item.label === label);
          if (!preset) return;
          const nextAspect =
            activeAspect?.value ??
            currentAspect ??
            ASPECT_RATIO_LABEL_PRESETS[0]!.value;
          /* 分辨率档：唯一解地换算成「百万像素 + 倍数」；百万像素档保持不变。 */
          apply(nextAspect, preset.megapixels, preset.multiple);
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
                const hit = multipleOptions.find(
                  (option) => option.label === label,
                );
                if (!hit) return;
                apply(
                  activeAspect?.value ??
                    currentAspect ??
                    ASPECT_RATIO_LABEL_PRESETS[0]!.value,
                  currentMp,
                  hit.value,
                );
              },
            } satisfies SegmentSection<string>,
          ]
        : []),
    ],
    [
      aspectOptions,
      activeAspect,
      currentAspect,
      currentMp,
      mpLabel,
      clarityOptions,
      apply,
      multiple,
      multipleLabel,
      multipleOptions,
    ],
  );

  /** 分辨率档的宽高提示（把「1k」这类档位在弹层里说明成具体像素）。 */
  const resolutionHint = useMemo(() => {
    const dims = resolutionDims(scene, activeRatio, "2k", table);
    return `1k/2k/4k 按${SIZE_SCENE_LABELS[scene]}场景的尺寸表取宽高（2k = ${dims.width}×${dims.height}）`;
  }, [scene, activeRatio, table]);

  /** 显示用：当前档位按比例换算出的宽高（百万像素档也一并算出，便于用户核对）。 */
  const currentDims = useMemo((): SizeDims | null => {
    const tier = resolutionTierOfLabel(mpLabel);
    if (tier) return resolutionDims(scene, activeRatio, tier, table);
    return null;
  }, [mpLabel, scene, activeRatio, table]);

  const footer = (
    <div className="space-y-1.5">
      <SizeTableFooter
        scene={scene}
        onOpen={() => setTableOpen(true)}
        extra={
          <span className="text-[10px] text-ink-faint">
            {currentDims
              ? `${currentDims.width}×${currentDims.height}`
              : resolutionHint}
          </span>
        }
      />
    </div>
  );

  return (
    <div className="space-y-2.5">
      <div
        className={
          narrow
            ? "flex items-start justify-end gap-3"
            : "rounded-lg border border-accent/30 bg-accent/4 p-2.5"
        }
      >
        {narrow ? (
          /* 窄版（画布节点 / 库内）：组合控件**右对齐**，左侧腾出来的区域摆这三个
           *  参数本身 —— 一行一个，端点骑跨卡片左缘，与节点上其他参数行长得一样
           *  （12px 大端点 + 参数名 + 类型徽章），不是控件框里那排「· 小点 + 名字」。
           *
           *  这三行各自是一个**真正的落点**（端点 id 即 ioKey）：拖到「百万像素」
           *  就连到 `megapixels`，不是笼统地落到整块控件上。 */
          <>
            <div className="flex min-w-0 flex-1 flex-col gap-0.5 self-center">
              {[aspect, megapixels, multiple]
                .filter((entry): entry is EnrichedWidget => !!entry)
                .map((entry) => (
                  <div
                    key={entry.ioKey}
                    /* 左内边距与节点上其他参数行同款（`pl-[14px]`）：端点圆点
                     *  12px、圆心骑跨卡片左缘（-6），文字从 14px 起 —— 圆点与
                     *  参数名之间才留得出 8px 的空隙。此前这里是 `pl-[2px]`，
                     *  圆点右沿（6px）压过文字起点（2px），名字被圆点盖住
                     *  （ISSUE #355：「端口圆点和参数名字之间距离太近」）。 */
                    className="relative flex h-[22px] items-center gap-1.5 pl-[14px]"
                    /* 行锚点：拖拽重排与 e2e 按它认「这一行是哪一格」。 */
                    data-io-key={entry.ioKey}
                  >
                    <PortHandle
                      id={entry.ioKey}
                      dir="in"
                      type={entry.type}
                      style={{ top: "50%", transform: "translateY(-50%)" }}
                    />
                    <span
                      className="min-w-0 truncate text-[12px] font-medium text-ink-bright"
                      style={{ fontFamily: "var(--font-sans)" }}
                    >
                      {entry.label ?? entry.name}
                    </span>
                    <span
                      className="bg-border-strong text-ink-muted inline-flex shrink-0 items-center rounded-[3px] px-1 py-px text-[10px] font-semibold"
                      style={{ fontFamily: "var(--font-sans)" }}
                    >
                      {typeDisplay(entry.type)}
                    </span>
                  </div>
                ))}
            </div>
            {/* 组合控件本体（表头 + 下拉），整块贴右沿：框里不再重复列那三个参数
                —— 它们已经以真正的参数行形态摆在框外左侧了。 */}
            <div
              data-grouped-box
              className="w-fit max-w-full shrink-0 rounded-lg border border-accent/30 bg-accent/4 p-2"
            >
              <span className="text-[10px] font-semibold tracking-wider text-accent uppercase">
                比例 + 像素{multiple ? " + 倍数" : ""}
              </span>
              <div className="mt-1 w-[168px] min-w-0">
                <MultiSegmentPopover
                  ariaLabel={
                    multiple ? "选择比例、像素与倍数" : "选择比例与像素"
                  }
                  triggerContent={`${activeAspect?.label ?? "自定义"} / ${mpLabel}${multiple ? ` / ${multipleLabel}` : ""}`}
                  sections={sections}
                  align="right"
                  disabled={disabled}
                  footer={footer}
                />
              </div>
              <RequiredChips
                pins={[aspect, megapixels, multiple]}
                onRequiredChange={onRequiredChange}
                mode={mode}
                visibilityMode={visibilityMode}
                onVisibilityChange={onVisibilityChange}
              />
            </div>
          </>
        ) : (
          <div>
            <div className="flex items-center gap-2">
              <span className="shrink-0 text-[10px] font-semibold tracking-wider text-accent uppercase">
                比例 + 像素{multiple ? " + 倍数" : ""}
              </span>
              <div className="min-w-0 flex-1">
                <MultiSegmentPopover
                  ariaLabel={
                    multiple ? "选择比例、像素与倍数" : "选择比例与像素"
                  }
                  triggerContent={`${activeAspect?.label ?? "自定义"} / ${mpLabel}${multiple ? ` / ${multipleLabel}` : ""}`}
                  sections={sections}
                  align="right"
                  disabled={disabled}
                  footer={footer}
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
        )}
      </div>

      {tableOpen && (
        <SizePresetTableModal scene={scene} onClose={() => setTableOpen(false)} />
      )}
    </div>
  );
}
