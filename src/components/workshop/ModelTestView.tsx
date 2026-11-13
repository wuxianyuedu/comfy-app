"use client";

// ── 「测试模型能力」**视图**（规范 §17.2 第③层：只渲染 + 上抛）─────────────
// 用工坊同款通道直接试已配置的远端模型（#3590）：左栏「用途 → 所有模式」
// 页签（#3635：每个模式页签显示配了适配器的候选模型数）→ 右栏模型下拉 →
// 尺寸（工作流库同款多段下拉）→ 按「模型适配」里配的统一输入逐项填 →
// 生成 → 工坊同款产物展示。
// 候选 / 适配器 / 生成动作都在 `hooks/use-model-test.ts`（第②层）与
// `model-test-config.ts`（第①层）；本文件不出现 fetch / api.*。

import { Button } from "~/components/ui/button";
import { DocumentFrame } from "~/components/studio/ViewContainer";
import { FilePickerButton } from "~/components/ui/file-picker";
import { FormField } from "~/components/ui/form-field";
import { Input } from "~/components/ui/input";
import { MediaThumbnail } from "~/components/ui/media-thumbnail";
import { PageHeader } from "~/components/ui/page-header";
import { SectionLabel } from "~/components/ui/section-label";
import { SelectChip } from "~/components/ui/select-chip";
import { SelectMenu } from "~/components/ui/select-menu";
import {
  MultiSegmentPopover,
  RatioIcon,
  type SegmentSection,
} from "~/components/ui/segment-popover";
import { pageHeaderTitle } from "~/components/studio/NavItems";
import { parseRatioFromLabel } from "~/components/studio/workflow-io";
import { ALIGN_MULTIPLE_OPTIONS, RESOLUTION_TIERS, sceneFromMode } from "~/lib/media/size-presets";
import { workshopInputLabel } from "~/lib/workshop/remote-model-adapter";
import type { WorkshopInputType } from "~/lib/workshop/remote-model-adapter";

import { cn } from "~/lib/utils";
import {
  ASPECT_RATIO_PRESETS,
  MODEL_TEST_KINDS,
  MODEL_TEST_KIND_LABELS,
  RELAY_INPUT_TYPES,
  clarityOptionsFor,
  controlForInputType,
  type ModelTestControl,
  type ModelTestKind,
  type ModelTestValues,
  type ModeTab,
} from "./model-test-config";
import { useModelTest } from "./hooks/use-model-test";

/** 统一输入里的「尺寸」四行（比例 / 百万像素 / 分辨率 / 倍数）：由工作流库
 *  同款多段下拉一并承担（ISSUE #3742），不再各占一排离散档位 chips。 */
const SIZE_INPUT_TYPES: ReadonlyArray<WorkshopInputType> = [
  "aspect-ratio",
  "megapixels",
  "resolution",
  "multiple",
];

/** 用途页签（图片 / 视频）：SelectChip 的 pill 单选组，与「模型适配」的
 *  候选选择同一交互件。 */
function KindTabs({
  kind,
  onChange,
}: {
  kind: ModelTestKind;
  onChange: (k: ModelTestKind) => void;
}) {
  return (
    <div aria-label="选择用途" className="flex flex-wrap gap-2" role="radiogroup">
      {MODEL_TEST_KINDS.map((k) => (
        <SelectChip
          key={k}
          onClick={() => {
            onChange(k);
          }}
          selected={kind === k}
          shape="pill"
        >
          {MODEL_TEST_KIND_LABELS[k]}
        </SelectChip>
      ))}
    </div>
  );
}

/** 左栏模式页签（#3635）：当前用途下的**所有**生成类模式纵列，右侧徽标
 *  显示配了该模式适配器的候选模型数。选中态与工坊阶段条同款（primary 软底
 *  + 描边）；role=radio + aria-checked 由选中项驱动，外层 radiogroup 给
 *  整组可访问名。 */
function ModeTabs({
  mode,
  onSelect,
  tabs,
}: {
  mode: string;
  onSelect: (mode: string) => void;
  tabs: Array<ModeTab>;
}) {
  return (
    <div aria-label="选择模式" className="flex flex-col gap-1.5" role="radiogroup">
      {tabs.map((t) => {
        const selected = t.mode === mode;
        return (
          <Button
            aria-checked={selected}
            className={cn(
              "h-auto justify-between gap-2 rounded-lg px-3 py-2 font-normal",
              selected
                ? "bg-primary/12 ring-primary/25 hover:bg-primary/12 ring-1"
                : "bg-surface hover:bg-surface",
            )}
            key={t.mode}
            onClick={() => {
              onSelect(t.mode);
            }}
            role="radio"
            variant="ghost"
          >
            <span className="min-w-0 text-left leading-tight">
              <span
                className={cn(
                  "block truncate text-sm font-semibold",
                  selected ? "text-primary" : "text-ink",
                )}
              >
                {t.label}
              </span>
              <span className="text-muted-foreground text-2xs block">{t.mode}</span>
            </span>
            <span
              className={cn(
                "shrink-0 rounded-full px-2 py-0.5 text-2xs tabular-nums",
                selected
                  ? "bg-primary/15 text-primary-strong"
                  : "bg-elevated text-muted-foreground",
              )}
            >
              {t.modelCount} 模型
            </span>
          </Button>
        );
      })}
    </div>
  );
}

/** 倍数段候选：对齐倍数（8/16/32/64，与工作流库同一份档）；当前值不在
 *  候选里时动态补上并排序（自由值也要可见、可再次选中）。 */
function multipleOptionsFor(current: string): Array<{ label: string; value: string }> {
  const options = ALIGN_MULTIPLE_OPTIONS.map((n) => String(n));
  if (current !== "" && !options.includes(current)) {
    const n = Number(current);
    if (Number.isFinite(n) && n > 0) {
      options.push(current);
      options.sort((a, b) => Number(a) - Number(b));
    }
  }
  return options.map((v) => ({ label: v, value: v }));
}

/** 尺寸：工作流库同款多段下拉（比例 / 像素（分辨率 · 百万像素）/ 倍数，
 *  ISSUE #3742）。与工作流库的两类表达同口径：选分辨率档时档位名随
 *  `resolution`、换算值随 `megapixels`、对齐倍数随 `multiple` 一起写回；
 *  选百万像素档只写总像素。倍数段只在适配器映射了它时出现；表单已按
 *  最常用档（1:1 + 1K）预置默认值，触发器常显摘要。 */
function SizeField({
  hasMultiple,
  mode,
  onPatch,
  values,
}: {
  hasMultiple: boolean;
  mode: string;
  onPatch: (type: keyof ModelTestValues, value: string) => void;
  values: ModelTestValues;
}) {
  const scene = sceneFromMode(mode);
  const ratioValue = values["aspect-ratio"] ?? "";
  const activeRatio = parseRatioFromLabel(ratioValue) ?? 1;
  const resolutionValue = values.resolution ?? "";
  const mpValue = values.megapixels ?? "";
  const multipleValue = values.multiple ?? "";

  const clarity = clarityOptionsFor(scene, activeRatio);
  /* 像素段的当前显示：分辨率档优先（档名大写），自由百万像素次之（M 值）。 */
  const mpLabel =
    resolutionValue === ""
      ? mpValue === ""
        ? ""
        : `${mpValue}M`
      : (RESOLUTION_TIERS.find((t) => t === resolutionValue) ?? resolutionValue).toUpperCase();

  const sections: Array<SegmentSection> = [
    {
      label: "比例",
      onChange: (value) => {
        onPatch("aspect-ratio", value);
      },
      options: ASPECT_RATIO_PRESETS.map((r) => ({
        label: r,
        render: <RatioIcon ratio={parseRatioFromLabel(r) ?? 1} />,
        value: r,
      })),
      value: ratioValue,
    },
    {
      label: "像素",
      onChange: (label) => {
        const hit = clarity.find((o) => o.label === label);
        if (hit === undefined) {
          return;
        }
        /* 分辨率档：档位名与换算值一起写回；百万像素档：清掉档名只带总像素。 */
        onPatch("resolution", hit.resolution);
        onPatch("megapixels", hit.megapixels);
        if (hit.multiple !== "") {
          onPatch("multiple", hit.multiple);
        }
      },
      options: clarity.map((o) => ({ label: o.label, subgroup: o.subgroup, value: o.label })),
      value: mpLabel,
    },
    ...(hasMultiple
      ? [
          {
            label: "倍数",
            onChange: (value: string) => {
              onPatch("multiple", value);
            },
            options: multipleOptionsFor(multipleValue),
            value: multipleValue,
          } satisfies SegmentSection,
        ]
      : []),
  ];

  const summary = [
    ratioValue === "" ? null : ratioValue,
    mpLabel === "" ? null : mpLabel,
    hasMultiple && multipleValue !== "" ? `×${multipleValue}` : null,
  ]
    .filter((part): part is string => part !== null)
    .join(" / ");

  return (
    <div className="w-64 min-w-0">
      <MultiSegmentPopover
        align="left"
        ariaLabel="选择尺寸"
        sections={sections}
        triggerContent={summary === "" ? "尺寸（可选）" : summary}
      />
    </div>
  );
}

/** 一行统一输入的渲染（按类型给控件；文案 = 输入类型的工坊名）。
 *  尺寸四行（比例 / 百万像素 / 分辨率 / 倍数）不在这里 —— 它们由 SizeField 的
 *  多段下拉统一承担（ISSUE #3742）。 */
function InputRow({
  control,
  disabled,
  hint,
  id,
  label,
  onChange,
  onPickFile,
  onRandom,
  value,
}: {
  control: ModelTestControl;
  disabled?: boolean;
  hint?: string;
  id: string;
  label: string;
  onChange: (value: string) => void;
  /** 图片类控件：选完文件回调（data URL 由逻辑层读）。 */
  onPickFile?: (file: File) => void;
  /** 提示词的随机按钮（ISSUE #3742）；给了才渲染。 */
  onRandom?: () => void;
  value: string;
}) {
  if (control === "prompt" || control === "negative") {
    return (
      <FormField hint={hint} id={id} label={label} labelClassName="mb-1.5">
        {(a11y) => (
          <div className="flex items-start gap-2">
            <textarea
              {...a11y}
              className={cn(
                "border-border bg-bg focus:border-primary w-full flex-1 resize-y rounded-lg border px-3 py-2 text-sm outline-none",
                disabled && "opacity-50",
              )}
              disabled={disabled}
              onChange={(e) => {
                onChange(e.target.value);
              }}
              placeholder={
                control === "prompt" ? "描述你想要生成的画面" : "不想出现的内容（可留空）"
              }
              rows={control === "prompt" ? 3 : 2}
              value={value}
            />
            {control === "prompt" && onRandom !== undefined && (
              <Button
                className="h-auto shrink-0 px-3 py-2 text-xs"
                disabled={disabled}
                onClick={onRandom}
                variant="outline"
              >
                随机
              </Button>
            )}
          </div>
        )}
      </FormField>
    );
  }
  if (control === "image") {
    return (
      <FormField hint={hint} id={id} label={label} labelClassName="mb-1.5">
        {(a11y) => (
          <div className="flex items-center gap-2">
            <FilePickerButton
              {...a11y}
              accept="image/*"
              disabled={disabled}
              onPick={(file) => {
                onPickFile?.(file);
              }}
              size="sm"
              variant="outline"
            >
              {value === "" ? "上传图片" : "换一张"}
            </FilePickerButton>
            {value !== "" && (
              <>
                <MediaThumbnail
                  alt={`${label}预览`}
                  as="image"
                  className="border-border h-10 w-10 rounded-lg border object-cover"
                  src={value}
                />
                <Button
                  aria-label={`清除${label}`}
                  className="text-muted-foreground/60 hover:text-danger-strong h-auto px-2 py-1 text-xs"
                  onClick={() => {
                    onChange("");
                  }}
                  size="sm"
                  variant="ghost"
                >
                  清除
                </Button>
              </>
            )}
          </div>
        )}
      </FormField>
    );
  }
  /* 分辨率档（#3622）已并入 SizeField 的「像素」段（分辨率 · 百万像素两行，
   * ISSUE #3742）—— 这里不再有独立的分辨率 chips。 */

  /* duration / number / text → 单行输入 */
  return (
    <FormField hint={hint} id={id} label={label} labelClassName="mb-1.5">
      {(a11y) => (
        <Input
          {...a11y}
          className="border-border bg-bg focus:border-primary h-auto w-48 rounded-lg px-3 py-2 text-sm"
          disabled={disabled}
          inputMode={control === "duration" || control === "number" ? "numeric" : "text"}
          onChange={(e) => {
            onChange(e.target.value);
          }}
          placeholder={control === "duration" ? "例如 5（秒）" : undefined}
          value={value}
        />
      )}
    </FormField>
  );
}

export function ModelTestView() {
  const c = useModelTest();

  const relaySet: ReadonlySet<WorkshopInputType> = new Set(RELAY_INPUT_TYPES[c.kind]);
  const selectedAdapter = c.adapters.find((a) => a.mode === c.mode) ?? null;
  /* 渲染哪些输入行：有适配器 → 它声明的映射行（工坊同款）；没有 → 该用途的
     通道承接集合（OpenAI 兼容默认映射），让未配适配器的模型也能先试。 */
  const inputRows: Array<{ relayed: boolean; type: WorkshopInputType }> =
    selectedAdapter === null
      ? [...relaySet].map((type) => ({ type, relayed: true }))
      : selectedAdapter.inputs.map((row) => ({ type: row.type, relayed: relaySet.has(row.type) }));

  /* 尺寸三件套走 SizeField 的多段下拉，其余类型仍逐行渲染。 */
  const otherRows = inputRows.filter((row) => !SIZE_INPUT_TYPES.includes(row.type));
  const hasSizeRow = otherRows.length !== inputRows.length;
  const modeLabel = c.modeTabs.find((t) => t.mode === c.mode)?.label ?? c.mode;

  return (
    <DocumentFrame
      className="flex flex-col gap-6 px-4 pt-4 pb-8 sm:px-8 sm:pt-5 sm:pb-12"
      width="wide"
    >
      <PageHeader srTitle={pageHeaderTitle("model-test")} />

      <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:gap-8">
        {/* 左栏：用途 + 所有模式（每个页签显示配了适配器的候选模型数，#3635） */}
        <aside className="flex shrink-0 flex-col gap-5 lg:w-60">
          <section>
            <SectionLabel hint="同一模型的图片 / 视频分栏测试">用途</SectionLabel>
            <KindTabs kind={c.kind} onChange={c.setKind} />
          </section>
          <section>
            <SectionLabel hint="工坊全部生成类模式；徽标 = 配了该模式适配器的候选模型数">
              模式
            </SectionLabel>
            <ModeTabs mode={c.mode} onSelect={c.setMode} tabs={c.modeTabs} />
          </section>
        </aside>

        {/* 右栏：模型下拉 → 统一输入 → 生成 → 产物 */}
        <div className="flex min-w-0 flex-1 flex-col gap-6">
          <section>
            <SectionLabel hint="「设置 → 远程模型」里启用的条目，按用途过滤">模型</SectionLabel>
            {c.loading ? (
              <p className="text-muted-foreground text-sm">加载中…</p>
            ) : c.candidates.length === 0 ? (
              <p className="bg-warning/10 text-warning-strong rounded-lg px-3 py-2 text-xs">
                还没有可测的{MODEL_TEST_KIND_LABELS[c.kind]}
                模型 —— 到「设置 → 远程模型」添加并启用用途为 {c.kind === "image"
                  ? "图像"
                  : "视频"}{" "}
                的条目。
              </p>
            ) : (
              <SelectMenu
                aria-label="选择模型"
                autoFitFromOptions={false}
                className="text-sm"
                fullWidth={false}
                onChange={c.selectModel}
                options={c.candidates.map((m) => m.name)}
                placeholder="选择要测试的模型…"
                popoverMinWidth={240}
                value={c.selectedModel}
              />
            )}
          </section>

          {c.selectedModel !== "" && (
            <>
              {selectedAdapter === null && (
                <p className="text-muted-foreground text-xs">
                  该模型没有「{modeLabel}
                  」模式的适配器 —— 将按 OpenAI 兼容默认映射直连（生图 /images/generations、视频
                  /videos）。要按接口字段精确适配，先到「模型适配」配置。
                </p>
              )}

              {/* 统一输入（工坊同款：有适配器按它的映射行，没有按通道默认集合） */}
              {selectedAdapter !== null && selectedAdapter.inputs.length === 0 ? (
                <p className="bg-warning/10 text-warning-strong rounded-lg px-3 py-2 text-xs">
                  该模式没有声明任何输入映射 —— 到「模型适配」为它添加输入行。
                </p>
              ) : (
                <section className="flex flex-col gap-4">
                  <SectionLabel hint="与工坊生成走同一份统一输入；适配器把它们翻译成接口字段">
                    统一输入
                  </SectionLabel>
                  {hasSizeRow && (
                    <FormField
                      hint="比例 / 像素（分辨率 · 百万像素）/ 倍数一次选完，与工作流库同款；已按最常用档预置默认值"
                      id="model-test-size"
                      label="尺寸"
                      labelClassName="mb-1.5"
                    >
                      {() => (
                        <SizeField
                          hasMultiple={inputRows.some((row) => row.type === "multiple")}
                          mode={c.mode}
                          onPatch={c.patchValue}
                          values={c.values}
                        />
                      )}
                    </FormField>
                  )}
                  {otherRows.map((row, i) => {
                    const control = controlForInputType(row.type);
                    const id = `model-test-input-${row.type}`;
                    const label = workshopInputLabel(row.type);
                    const relayed = row.relayed;
                    const hint = relayed
                      ? undefined
                      : "API 通道暂未承接这类输入（工坊完整链路才有）—— 填了也会被忽略";
                    return (
                      <InputRow
                        control={control}
                        disabled={!relayed}
                        hint={hint}
                        id={`${id}-${String(i)}`}
                        key={`${row.type}-${String(i)}`}
                        label={relayed ? label : `${label}（未承接）`}
                        onChange={(value) => {
                          c.patchValue(row.type, value);
                        }}
                        onPickFile={(file) => {
                          if (row.type === "first-frame" || row.type === "image") {
                            void c.setInputFromFile(row.type, file);
                          }
                        }}
                        onRandom={
                          row.type === "prompt"
                            ? () => {
                                c.randomizePrompt();
                              }
                            : undefined
                        }
                        value={c.values[row.type] ?? ""}
                      />
                    );
                  })}
                </section>
              )}

              {/* 生成 */}
              <div className="flex items-center gap-3">
                <Button
                  className="h-auto px-4 py-2"
                  disabled={c.generating}
                  onClick={() => {
                    void c.generate();
                  }}
                  variant="primary-solid"
                >
                  {c.generating ? "生成中…" : "生成"}
                </Button>
                <span className="text-muted-foreground text-2xs">
                  真实调用，按上游计费 —— 与工坊生成走同一条通道。
                </span>
              </div>

              {c.error !== null && (
                <p className="bg-destructive/10 text-destructive rounded-lg px-3 py-2 text-xs">
                  {c.error}
                </p>
              )}

              {c.result !== null && (
                <section className="flex flex-col gap-2">
                  <SectionLabel hint="工坊同款产物提取（适配器 outputField / 通用提取）">
                    产物
                  </SectionLabel>
                  <div className="border-border bg-bg overflow-hidden rounded-xl border">
                    <MediaThumbnail
                      alt="生成结果"
                      as={c.result.kind === "video" ? "video" : "image"}
                      className="max-h-[28rem] w-full object-contain"
                      controls
                      src={c.result.url}
                    />
                  </div>
                  <a
                    className="text-primary text-xs underline-offset-2 hover:underline"
                    href={c.result.url}
                    rel="noreferrer"
                    target="_blank"
                  >
                    打开原始产物
                  </a>
                </section>
              )}
            </>
          )}
        </div>
      </div>
    </DocumentFrame>
  );
}
