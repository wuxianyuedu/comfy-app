"use client";
/* 尺寸组合控件之一：宽高比 + 百万像素 (+ 倍数) 形态（ResolutionSelector 类节点）。
 *
 * 这类节点不暴露 width/height，只暴露`aspect_ratio`（COMBO，值是形如
 *"16:9 (Widescreen)" 的标签）+`megapixels`（FLOAT，1 ≈ 1M 总像素），
 * 有的话再加一个宽高对齐倍数端口。因此没有宽高可推算，弹层把值直接写到这几个
 * widget 上。
 *
 * 「像素」一栏同时给两类档位（用户口径）：
 * · 「分辨率」（1k/2k/4k）：按场景尺寸表算出宽高，再唯一解地换算成
 * 「百万像素 + 倍数」写下去；
 * · 「百万像素」（1M/2M/4M）：直接写该档位的总像素量，倍数保持不变。
 *`megapixels` 是 FLOAT（连续量），因此百万像素那一组下面还有一条「自定义」
 * 步进器（`MegapixelStepper`）—— 档位之外能填 2.5 这类任意值。
 *
 * ComfyUI 可达时，精选针脚带`options`，我们
 * 原样渲染它们（高亮仍有效，因为我们从
 * 每个选项串里解析出比例）。不可达时（存储的 IO 表里缺 type/options）
 * 回落到内置的`ASPECT_RATIO_LABEL_PRESETS`。 */

import { useCallback, useMemo, useState } from "react";

import {
  ALIGN_MULTIPLE_OPTIONS,
  MEGAPIXEL_TIERS,
  RESOLUTION_TIERS,
  SIZE_SCENE_LABELS,
  alignMultipleOf,
  megapixelLabel,
  megapixelsOf,
  resolutionDims,
  sceneFromMode,
  type AlignMultiple,
  type SizeDims,
} from "~/lib/media/size-presets";
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
} from "../workflow-io";
import {
  MultiSegmentPopover,
  RatioIcon,
  shortRatioLabel,
  type SegmentSection,
} from "~/components/ui/segment-popover";
import { SizePresetTableModal } from "./SizePresetTableModal";
import { MegapixelStepper } from "./MegapixelStepper";
import { useSizePresetTable } from "./hooks/use-size-preset-table";
import { PortHandle } from "./WorkflowFormControls";
import {
  RequiredChips,
  SizeTableFooter,
  type AspectMegaGroup,
} from "./DimensionControlParts";

/* ── 三个纯派生（§17.1：删掉 JSX 也能测）──
 * 从组件体提出：入参全是显式事实，输出是选项清单。useMemo 只保留调用。 */

/** 比例段候选：优先用工作流自己的 options，否则给内置预设表；未知标签按
 *  「宽:高」解析比例，解析不出按 1:1（只影响图标的形状，不影响写回的值）。 */
function buildAspectOptions(
  options: string[] | undefined,
): { value: string; label: string; ratio: number }[] {
  const source =
    Array.isArray(options) && options.length > 0
      ? options
      : ASPECT_RATIO_LABEL_PRESETS.map((preset) => preset.value);
  return source.map((value) => {
    const known = ASPECT_RATIO_LABEL_PRESETS.find(
      (preset) => preset.value === value,
    );
    if (known) return { value, label: known.label, ratio: known.ratio };
    const ratio = parseRatioFromLabel(value);
    return { value, label: shortRatioLabel(value), ratio: ratio ?? 1 };
  });
}

/** 「像素」一栏的档位：分辨率（查场景表换算）与百万像素（直接给值）两行。 */
function buildClarityOptions(input: {
  scene: ReturnType<typeof sceneFromMode>;
  activeRatio: number;
  table: ReturnType<typeof useSizePresetTable>["table"];
  currentMultiple: AlignMultiple;
}): {
  label: string;
  subgroup: string;
  megapixels: number;
  multiple: AlignMultiple;
}[] {
  const { scene, activeRatio, table, currentMultiple } = input;
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
}

/** 倍数段候选：优先工作流自己的 options，否则 8/16/32/64；当前值不在候选里
 *  时动态补上并排序（自由倍数也要在列表里可见、可再次选中）。 */
function buildMultipleOptions(input: {
  multiple: EnrichedWidget | undefined;
  currentMultiple: AlignMultiple;
}): { value: number; label: string }[] {
  const { multiple, currentMultiple } = input;
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
}

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
  /* 只有基本类型才安全 stringify —— 对象值会渲染成
   *"[object Object]" 并破坏下面的预设反检测。 */
  const currentAspect =
    typeof rawAspect === "string"
      ? rawAspect
      : typeof rawAspect === "number"
        ? String(rawAspect)
        : "";
  const currentMp =
    Number(values[megapixels.ioKey] ?? megapixels.defaultValue ?? 1) || 1;

  /** 候选章：节点自己的 COMBO 选项（可用时）。 */
  const aspectOptions = useMemo(
    () => buildAspectOptions(aspect.options),
    [aspect.options],
  );

  /** 反检测活跃章，好让手打的值也能高亮。 */
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

  /** 写回`aspect_ratio` 时用的值：选中的 → 节点当前值 → 第一个预设。
   *
   * 三个写入口（比例 / 像素 / 倍数 / 自定义百万像素）都要它，各写一遍会分叉
   * （任一处漏了末级兜底，用户没选过比例时就会被写成空串，节点静默清空）。 */
  const aspectValue = useMemo(
    () =>
      activeAspect?.value ??
      currentAspect ??
      ASPECT_RATIO_LABEL_PRESETS[0]!.value,
    [activeAspect, currentAspect],
  );

  /* ── 倍数段：像素倍数（对齐网格），跟比例 / 像素并列写进同一个 popover ──
   * 语义是「宽高像素取该值的倍数」（如 8 → 尺寸是 8 的倍数），不是缩放
   * 系数。候选项优先用工作流自己的 options，否则给 8/16/32/64
   * （与尺寸表配置里的倍数候选同一份）。当前值不在候选里时动态补上。 */
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

  const clarityOptions = useMemo(
    () => buildClarityOptions({ scene, activeRatio, table, currentMultiple }),
    [scene, activeRatio, table, currentMultiple],
  );

  /* 当前 megapixels 值落在哪个档位上：分辨率档按「该档换算出的总像素」比对，
   * 百万像素档按档位数值比对。
   *
   * 必须是**精确**命中（容差 0.01）：自由值（2.5M，步进器填的）不能被「最近的
   * 档位」吸走名字 —— 16:9 的 2k 档换算出来是 2.359M，比 2M 离它更近，于是
   * 触发器会显示成「2k」，用户看着像「我填的 2.5 没了」。命不中档位就按自由值
   * 显示（`2.5M`）。 */
  const mpLabel = useMemo(() => {
    const exact = clarityOptions.find(
      (option) => Math.abs(option.megapixels - currentMp) < 0.01,
    );
    return exact?.label ?? megapixelLabel(currentMp);
  }, [clarityOptions, currentMp]);

  const multipleOptions = useMemo(
    () => buildMultipleOptions({ multiple, currentMultiple }),
    [multiple, currentMultiple],
  );

  const multipleLabel = useMemo(
    () => String(currentMultiple),
    [currentMultiple],
  );

  /* 用户只改百万像素数时，保留工作流自己的写法 ——
   * 往一个把选项写成别的拼法的节点里写预设串
   * 会静默清空该针脚。 */
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
          /* 分辨率档：唯一解地换算成「百万像素 + 倍数」；百万像素档保持不变。 */
          apply(aspectValue, preset.megapixels, preset.multiple);
        },
        /* 百万像素在端口上是 FLOAT（连续量），档位只是常用值 —— 档位之外再给一个
         * 能填任意值的步进器（挨着「百万像素」那一行渲染）。 */
        extra: (
          <MegapixelStepper
            value={currentMp}
            disabled={disabled}
            onChange={(megapixels) =>
              apply(aspectValue, megapixels, currentMultiple)
            }
          />
        ),
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
                apply(aspectValue, currentMp, hit.value);
              },
            } satisfies SegmentSection<string>,
          ]
        : []),
    ],
    [
      aspectOptions,
      activeAspect,
      aspectValue,
      currentMp,
      currentMultiple,
      disabled,
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
    <div className="flex flex-col gap-1.5">
      <SizeTableFooter
        scene={scene}
        onOpen={() => setTableOpen(true)}
        extra={
          <span className="text-ink-faint text-[10px]">
            {currentDims
              ? `${currentDims.width}×${currentDims.height}`
              : resolutionHint}
          </span>
        }
      />
    </div>
  );

  return (
    <div className="flex-col gap-2.5">
      <div
        className={
          narrow
            ? "flex items-start justify-end gap-3"
            : "border-accent/30 bg-accent/4 rounded-lg border p-2.5"
        }
      >
        {narrow ? (
          /* 窄版（画布节点 / 库内）：组合控件**右对齐**，左侧腾出来的区域摆这三个
           * 参数本身 —— 一行一个，端点骑跨卡片左缘，与节点上其他参数行长得一样
           * （12px 大端点 + 参数名 + 类型徽章），不是控件框里那排「· 小点 + 名字」。
           *
           * 这三行各自是一个**真正的落点**（端点 id 即 ioKey）：拖到「百万像素」
           * 就连到`megapixels`，不是笼统地落到整块控件上。 */
          <>
            <div className="flex min-w-0 flex-1 flex-col gap-0.5 self-center">
              {[aspect, megapixels, multiple]
                .filter((entry): entry is EnrichedWidget => !!entry)
                .map((entry) => (
                  <div
                    key={entry.ioKey}
                    /* 左内边距与节点上其他参数行同款（`pl-3.5`）：端点圆点
                     * 12px、圆心骑跨卡片左缘（-6），文字从 14px 起 —— 圆点与
                     * 参数名之间才留得出 8px 的空隙。此前这里是`pl-0.5`，
                     * 圆点右沿（6px）压过文字起点（2px），名字被圆点盖住
                     * （ISSUE #355：「端口圆点和参数名字之间距离太近」）。 */
                    className="relative flex h-5.5 items-center gap-1.5 pl-3.5"
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
                      className="text-ink-bright min-w-0 truncate text-[12px] font-medium"
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
              className="border-accent/30 bg-accent/4 w-fit max-w-full shrink-0 rounded-lg border p-2"
            >
              <span className="text-accent text-[10px] font-semibold tracking-wider uppercase">
                比例 + 像素{multiple ? " + 倍数" : ""}
              </span>
              <div className="mt-1 w-42 min-w-0">
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
              <span className="text-accent shrink-0 text-[10px] font-semibold tracking-wider uppercase">
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
        <SizePresetTableModal
          scene={scene}
          onClose={() => setTableOpen(false)}
        />
      )}
    </div>
  );
}
