"use client";

import { useState } from "react";

// ── 「测试模型能力」**视图**（规范 §17.2 第③层：只渲染 + 上抛）─────────────
// 用工坊同款通道直接试已配置的远端模型（#3590）：左栏「用途 → 所有模式」
// 页签（#3635：每个模式页签显示配了适配器的候选模型数）→ 右栏模型下拉
// （#3778：按所选模式收窄，只列配了该模式适配器的模型）→ 统一输入
// （#3778：行清单来自模式契约，带必备 / 可选标识）→ 尺寸（工作流库同款
// ShotSizePicker）→ 生成 → 工坊同款产物展示。
// 候选 / 适配器 / 契约 / 生成动作都在 `hooks/use-model-test.ts`（第②层）与
// `model-test-config.ts`（第①层）；本文件不出现 fetch / api.*。

import { Button } from "~/components/ui/button";
import { DocumentFrame } from "~/components/studio/ViewContainer";
import { FilePickerButton } from "~/components/ui/file-picker";
import { FormField } from "~/components/ui/form-field";
import { Input } from "~/components/ui/input";
import { MediaThumbnail } from "~/components/ui/media-thumbnail";
import { ViewableImage } from "~/components/ui/image-viewer";
import { PageHeader } from "~/components/ui/page-header";
import { SectionLabel } from "~/components/ui/section-label";
import { SelectChip } from "~/components/ui/select-chip";
import { TruncatedText } from "~/components/ui/truncated-text";
import { SelectMenu } from "~/components/ui/select-menu";
import { pageHeaderTitle } from "~/components/studio/NavItems";
import { sceneFromMode } from "~/lib/media/size-presets";
import { ShotSizePicker } from "~/components/workshop/ShotSizePicker";
import type { WorkshopInputType } from "~/lib/workshop/remote-model-adapter";

import { cn } from "~/lib/utils";
import {
  MODEL_TEST_KINDS,
  MODEL_TEST_KIND_LABELS,
  candidateLabel,
  candidateValue,
  sizeSpecToValues,
  sizeValuesToSpec,
  type ModelTestControl,
  type ModelTestKind,
  type ModelTestValues,
  type ModeTab,
} from "./model-test-config";
import { RequestDetailSection } from "./ModelTestRequestDetail";
import { useModelTest } from "./hooks/use-model-test";

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
              <TruncatedText
                className={cn(
                  "block truncate text-sm font-semibold",
                  selected ? "text-primary" : "text-ink",
                )}
              >
                {t.label}
              </TruncatedText>
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

/** 尺寸：与工作流库**同一个**选择器（ShotSizePicker，ISSUE #3778 问题 4）。
 *  比例 / 像素（分辨率 · 百万像素）/ 倍数一段不缺，倍数段只在选中百万像素档
 *  时出现（分辨率档宽高由场景尺寸表给定，倍数没有意义）。表单值与 SizeSpec
 *  两套形状的换算在 model-test-config（sizeValuesToSpec / sizeSpecToValues，
 *  全部走 size-presets 的既有纯函数）。 */
function SizeField({
  disabled,
  mode,
  onPatchValues,
  values,
}: {
  disabled?: boolean;
  mode: string;
  onPatchValues: (patch: Partial<ModelTestValues>) => void;
  values: ModelTestValues;
}) {
  const scene = sceneFromMode(mode);
  return (
    <div className="w-64 min-w-0">
      <ShotSizePicker
        disabled={disabled}
        onChange={(next) => {
          onPatchValues(sizeSpecToValues(next, scene));
        }}
        scene={scene}
        value={sizeValuesToSpec(values)}
      />
    </div>
  );
}

/** 必备 / 可选标识（ISSUE #3778 问题 2）：来自模式契约的 required 生效集。 */
function RequiredBadge({ required }: { required: boolean }) {
  return (
    <span
      className={cn(
        "shrink-0 rounded-full px-1.5 py-0.5 text-2xs",
        required ? "bg-primary/12 text-primary-strong" : "bg-elevated text-muted-foreground",
      )}
    >
      {required ? "必填" : "可选"}
    </span>
  );
}

/** 一行统一输入的渲染（按类型给控件；文案 = 契约口的展示名）。行标签右侧带
 *  必填 / 可选标识（ISSUE #3778，来自契约 required）。尺寸复合口不在这里 ——
 *  由 SizeField 的 ShotSizePicker 统一承担。 */
function InputRow({
  control,
  disabled,
  hint,
  id,
  label,
  onChange,
  onPickFile,
  onRandom,
  required,
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
  required: boolean;
  value: string;
}) {
  const labelNode = (
    <span className="flex min-w-0 items-center gap-1.5">
      <TruncatedText className="truncate">{label}</TruncatedText>
      <RequiredBadge required={required} />
    </span>
  );
  if (control === "prompt" || control === "negative") {
    return (
      <FormField hint={hint} id={id} label={labelNode} labelClassName="mb-1.5">
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
      <FormField hint={hint} id={id} label={labelNode} labelClassName="mb-1.5">
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
    <FormField hint={hint} id={id} label={labelNode} labelClassName="mb-1.5">
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

/** 参考图多选行（#3949 需求 6/7）：一个契约口（reference-image）收多张，
 *  请求里以数组整体下发；清除按钮悬停时出现在缩略图右上角。 */
function ReferenceImageField({
  disabled,
  hint,
  id,
  images,
  label,
  onAdd,
  onRemove,
  required,
}: {
  disabled?: boolean;
  hint?: string;
  id: string;
  images: Array<string>;
  label: string;
  onAdd: (files: Array<File>) => void;
  onRemove: (index: number) => void;
  required: boolean;
}) {
  const labelNode = (
    <span className="flex min-w-0 items-center gap-1.5">
      <TruncatedText className="truncate">{label}</TruncatedText>
      <RequiredBadge required={required} />
    </span>
  );
  return (
    <FormField hint={hint} id={id} label={labelNode} labelClassName="mb-1.5">
      {() => (
        <div className="flex flex-wrap items-center gap-2">
          {images.map((src, i) => (
            <div className="group relative" key={`${String(i)}-${src.slice(0, 24)}`}>
              <MediaThumbnail
                alt={`参考图 ${i + 1}`}
                as="image"
                className="border-border size-16 rounded-lg border object-cover"
                src={src}
              />
              {/* 清除按钮：悬停才出现在缩略图右上角（#3949 需求 7）。 */}
              <Button
                aria-label={`移除第 ${i + 1} 张参考图`}
                className="text-2xs absolute top-1 right-1 hidden rounded-full bg-black/60 px-1.5 py-0.5 leading-none text-white group-hover:block"
                onClick={() => {
                  onRemove(i);
                }}
                size="sm"
                variant="ghost"
              >
                ✕
              </Button>
            </div>
          ))}
          <FilePickerButton
            accept="image/*"
            className="h-auto px-3 py-2 text-xs"
            disabled={disabled}
            multiple
            onPick={(_file, files) => {
              onAdd([...files]);
            }}
            size="sm"
            variant="outline"
          >
            {images.length > 0 ? "添加图片" : "上传参考图"}
          </FilePickerButton>
        </div>
      )}
    </FormField>
  );
}

export function ModelTestView() {
  const c = useModelTest();
  /* 响应摘要的显示形态（#3799）：默认格式化，可切回原始单行。 */
  const [excerptPretty, setExcerptPretty] = useState(true);

  const selectedAdapter = c.adapters.find((a) => a.mode === c.mode) ?? null;
  /* 选中的工作流候选（#4080 评论 4）：提示与门禁都按「本地工作流」走。 */
  const selectedWorkflow = c.selectedWorkflow;
  /* 适配器映射了的统一输入类型集合：契约行通道承接得住、但适配器没映射时，
   * 生成不会带上那个值 —— 行上明说，不静默丢（映射关系只在有适配器时存在）。 */
  const mappedTypes = new Set<WorkshopInputType>(
    (selectedAdapter?.inputs ?? []).map((row) => row.type),
  );
  /* 统一输入行来自模式契约（ISSUE #3778），行序 = 契约口序（ISSUE #3785）：
   * 复合尺寸口也在它契约里的位置上渲染，不整体前移。 */
  const modeLabel = c.modeTabs.find((t) => t.mode === c.mode)?.label ?? c.mode;
  /* 回调里读 c.result 会丢掉 JSX 条件的收窄 —— 先取一次稳定引用。
     对话测试（#4080）的产物是文本，没有可外链的 URL。 */
  const resultUrl = c.result !== null && c.result.kind !== "chat" ? c.result.url : null;
  /* 请求详情的行：生成后用真实读数；生成前显示「准备请求」（#3949 需求 8，
   * 按当前模式 / 模型 / 输入现算）—— 切模式 / 换模型时 hook 已清空读数，
   * 不会残留上一份。 */
  const detailRows =
    c.debugRows.length > 0 ? c.debugRows : c.previewRows.length > 0 ? c.previewRows : [];
  const previewOnly = c.debugRows.length === 0 && c.previewRows.length > 0;

  return (
    <DocumentFrame
      className="flex flex-col gap-6 px-4 pt-4 pb-8 sm:px-8 sm:pt-5 sm:pb-12"
      width="wide"
    >
      <PageHeader srTitle={pageHeaderTitle("model-test")} />

      <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:gap-8">
        {/* 左栏：用途 + 所有模式（每个页签显示配了适配器的候选模型数，#3635）。
            桌面下吸附成独立滚动区（ISSUE #3806）：右侧内容滚动不带动左栏，
            页签超出视口时在栏内自己滚。 */}
        <aside className="flex shrink-0 flex-col gap-5 lg:sticky lg:top-5 lg:max-h-[calc(100dvh-120px)] lg:w-60 lg:overflow-y-auto">
          <section>
            <SectionLabel hint="同一模型的图片 / 视频 / 对话分栏测试（#4080：本地模型含 Ollama 对话模型与工作流提供的图片/视频模型）">
              用途
            </SectionLabel>
            <KindTabs kind={c.kind} onChange={c.setKind} />
          </section>
          {c.modeTabs.length > 0 && (
            <section>
              <SectionLabel hint="工坊全部生成类模式；徽标 = 配了该模式适配器的候选模型数">
                模式
              </SectionLabel>
              <ModeTabs mode={c.mode} onSelect={c.setMode} tabs={c.modeTabs} />
            </section>
          )}
        </aside>

        {/* 右栏：模型下拉 → 统一输入 → 生成 → 产物 */}
        <div className="flex min-w-0 flex-1 flex-col gap-6">
          <section>
            <SectionLabel
              hint={
                c.kind === "chat"
                  ? "本地模型来自「设置 → 本地模型」（Ollama 候选）；远端模型来自「设置 → 远程模型」里用途为 对话 的条目"
                  : "本地模型来自工作流库的生图 / 视频工作流（与工坊「生成资源」同一份配置）；远端模型来自「设置 → 远程模型」里启用的条目；按用途与所选模式过滤"
              }
            >
              模型
            </SectionLabel>
            {c.loading ? (
              <p className="text-muted-foreground text-sm">加载中…</p>
            ) : c.candidates.length === 0 ? (
              c.kindCandidateCount === 0 ? (
                <p className="bg-warning/10 text-warning-strong rounded-lg px-3 py-2 text-xs">
                  {c.kind === "chat"
                    ? "还没有可测的对话模型 —— 本地模型到「设置 → 本地模型」添加 Ollama 候选；远端模型到「设置 → 远程模型」添加用途为 对话 的条目。"
                    : `还没有可测的${MODEL_TEST_KIND_LABELS[c.kind]}模型 —— 本地模型到工作流库导入${
                        c.kind === "image" ? "生图" : "视频"
                      }工作流（工坊封装就绪后出现在这里）；远端模型到「设置 → 远程模型」添加并启用用途为 ${
                        c.kind === "image" ? "图像" : "视频"
                      } 的条目。`}
                </p>
              ) : (
                <p className="bg-warning/10 text-warning-strong rounded-lg px-3 py-2 text-xs">
                  当前「{modeLabel}
                  」模式下没有可用模型（页签徽标的数字就是它的候选数）——
                  远端模型需要先在「模型适配」配置该模式的适配器；本地工作流需要支持该模式（工作流库
                  → 模式）。
                </p>
              )
            ) : (
              <SelectMenu
                aria-label="选择模型"
                autoFitFromOptions={false}
                className="text-sm"
                fullWidth={false}
                /* 本地 / 远端分组（#4080；评论 4 起图片 / 视频同样分组）：
                 * 对话的本地 = Ollama 候选；图片 / 视频的本地 = 工作流库工作流
                 * （工坊「生成资源」同源），远端 = 设置页配置的远端模型。 */
                groups={(
                  [
                    {
                      label: "本地模型",
                      options: c.candidates.filter((m) => m.local).map(candidateValue),
                    },
                    {
                      label: "远端模型",
                      options: c.candidates.filter((m) => !m.local).map((m) => m.name),
                    },
                  ] as const
                ).filter((group) => group.options.length > 0)}
                labels={Object.fromEntries(
                  c.candidates.map((m) => [candidateValue(m), candidateLabel(m)] as const),
                )}
                onChange={c.selectModel}
                options={c.candidates.map(candidateValue)}
                placeholder="选择要测试的模型…"
                popoverMinWidth={240}
                value={c.selectedModel}
              />
            )}
          </section>

          {c.selectedModel !== "" && (
            <>
              {selectedWorkflow === null ? (
                selectedAdapter === null &&
                c.kind !== "chat" && (
                  <p className="text-muted-foreground text-xs">
                    该模型没有「{modeLabel}
                    」模式的适配器 —— 将按 OpenAI 兼容默认映射直连（生图 /images/generations、视频
                    /videos）。要按接口字段精确适配，先到「模型适配」配置。
                  </p>
                )
              ) : (
                <p className="text-muted-foreground text-xs">
                  本地工作流模型：经工坊本地通道（ComfyUI）执行 ——
                  {selectedWorkflow.encapsulationReady
                    ? "输入按模式契约落到工作流连线的端口上，未连线的口沿用工作流图内默认值。"
                    : "该工作流还没有完成工坊封装（提示词口未连线），生成前先到工作流库「工坊封装」补线。"}
                </p>
              )}

              {/* 统一输入（行清单来自模式契约，必备 / 可选随契约走；ISSUE #3778） */}
              <section className="flex flex-col gap-4">
                <SectionLabel hint="与工坊生成走同一份统一输入（模式契约的对外参数）；适配器把它们翻译成接口字段">
                  统一输入
                </SectionLabel>
                {c.inputRows.map((row, i) => {
                  /* 行序 = 契约口序（ISSUE #3785）：复合尺寸口也在它契约
                   * 里的位置上渲染，不整体前移。 */
                  if (row.control === "size") {
                    return (
                      <FormField
                        hint={
                          row.disabled
                            ? "API 通道暂未承接尺寸输入（工坊完整链路才有）"
                            : "比例 / 像素（分辨率 · 百万像素）/ 倍数一次选完，与工作流库同款；已按最常用档预置默认值"
                        }
                        id={`model-test-size-${String(i)}`}
                        key={`${row.id}-${String(i)}`}
                        label={
                          <span className="flex min-w-0 items-center gap-1.5">
                            <TruncatedText className="truncate">
                              {row.disabled ? `${row.label}（未承接）` : row.label}
                            </TruncatedText>
                            <RequiredBadge required={row.required} />
                          </span>
                        }
                        labelClassName="mb-1.5"
                      >
                        {() => (
                          <SizeField
                            disabled={row.disabled}
                            mode={c.mode}
                            onPatchValues={c.patchValues}
                            values={c.values}
                          />
                        )}
                      </FormField>
                    );
                  }
                  const control: ModelTestControl = row.control;
                  const id = `model-test-input-${row.id}`;
                  /* 通道承接得住、但适配器没映射 → 提示「生成不会带上」，别让
                   * 用户填了值却在请求里静默消失。 */
                  const unmapped =
                    !row.disabled &&
                    row.valueKey !== null &&
                    selectedAdapter !== null &&
                    !mappedTypes.has(row.valueKey);
                  const hint = row.disabled
                    ? "API 通道暂未承接这类输入（工坊完整链路才有）—— 填了也会被忽略"
                    : unmapped
                      ? "适配器没有映射这个输入 —— 本次生成不会带上它；要带上请到「模型适配」为它配字段映射"
                      : undefined;
                  /* 参考图契约口（#3949 需求 6/7）：一行收多张、数组下发，
                       缩略图悬停显示清除按钮。 */
                  if (row.id === "reference-image" && control === "image") {
                    return (
                      <ReferenceImageField
                        disabled={row.disabled}
                        hint={hint}
                        id={`${id}-${String(i)}`}
                        images={c.referenceImages}
                        key={`${row.id}-${String(i)}`}
                        label={row.label}
                        onAdd={(files) => {
                          void c.addReferenceImages(files);
                        }}
                        onRemove={c.removeReferenceImage}
                        required={row.required}
                      />
                    );
                  }
                  return (
                    <InputRow
                      control={control}
                      disabled={row.disabled}
                      hint={hint}
                      id={`${id}-${String(i)}`}
                      key={`${row.id}-${String(i)}`}
                      label={row.disabled ? `${row.label}（未承接）` : row.label}
                      onChange={(value) => {
                        if (row.valueKey !== null) {
                          c.patchValue(row.valueKey, value);
                        }
                      }}
                      onPickFile={(file) => {
                        if (row.valueKey === "first-frame" || row.valueKey === "image") {
                          void c.setInputFromFile(row.valueKey, file);
                        }
                      }}
                      onRandom={
                        row.valueKey === "prompt"
                          ? () => {
                              c.randomizePrompt();
                            }
                          : undefined
                      }
                      required={row.required}
                      value={row.valueKey === null ? "" : (c.values[row.valueKey] ?? "")}
                    />
                  );
                })}
              </section>

              {/* 生成（#3949 需求 5：生成中可取消；#4080：对话用途是「发送」） */}
              <div className="flex items-center gap-3">
                <Button
                  className="h-auto px-4 py-2"
                  disabled={c.generating}
                  onClick={() => {
                    void c.generate();
                  }}
                  variant="primary-solid"
                >
                  {c.generating
                    ? c.kind === "chat"
                      ? "发送中…"
                      : "生成中…"
                    : c.kind === "chat"
                      ? "发送"
                      : "生成"}
                </Button>
                {c.generating && (
                  <Button
                    className="h-auto px-3 py-2 text-xs"
                    onClick={c.cancelGenerate}
                    variant="outline"
                  >
                    {c.kind === "chat" ? "取消发送" : "取消生成"}
                  </Button>
                )}
                <span className="text-muted-foreground text-2xs">
                  {c.kind === "chat"
                    ? "真实调用被测模型 —— 本地模型走设置里配置的本地服务，远端模型按名直连。"
                    : selectedWorkflow === null
                      ? "真实调用，按上游计费 —— 与工坊生成走同一条通道。"
                      : "真实运行本地工作流 —— 与工坊生成走同一条本地通道（ComfyUI）。"}
                </span>
              </div>

              {/* 本地工作流任务的实时进度（#4080 评论 4）：SSE state 帧，
                  整百分比变化才更新（hook 侧节流）。 */}
              {c.generating && c.workflowProgress !== null && (
                <p className="text-muted-foreground text-xs" role="status">
                  进度 {Math.floor(c.workflowProgress.pct)}%
                  {c.workflowProgress.label !== undefined && c.workflowProgress.label !== ""
                    ? `（${c.workflowProgress.label}）`
                    : ""}
                </p>
              )}

              {c.error !== null && (
                <p className="bg-destructive/10 text-destructive rounded-lg px-3 py-2 text-xs">
                  {c.error}
                </p>
              )}

              {c.notice !== null && (
                <p
                  className={cn(
                    "rounded-lg px-3 py-2 text-xs",
                    c.notice.kind === "ok"
                      ? "bg-elevated text-muted-foreground"
                      : "bg-destructive/10 text-destructive",
                  )}
                >
                  {c.notice.text}
                </p>
              )}

              {c.result !== null && (
                <section className="flex flex-col gap-2">
                  <SectionLabel hint="工坊同款产物提取（适配器 outputField / 通用提取）；图片点开进查看器，可缩放并显示原始尺寸">
                    产物
                  </SectionLabel>
                  <div className="border-border bg-bg overflow-hidden rounded-xl border">
                    {c.result.kind === "image" ? (
                      /* 图片查看器（ISSUE #3791）：点缩略图进 ImageViewer（缩放 +
                       * 原始宽高显示）；视频保持既有播放器。 */
                      <ViewableImage
                        alt="生成结果"
                        className="max-h-[28rem] w-full object-contain"
                        label="生成结果"
                        src={c.result.url}
                      />
                    ) : c.result.kind === "video" ? (
                      <MediaThumbnail
                        alt="生成结果"
                        as="video"
                        className="max-h-[28rem] w-full object-contain"
                        controls
                        src={c.result.url}
                      />
                    ) : (
                      /* 对话测试（#4080）：产物是模型的文本回复。 */
                      <pre className="text-ink text-2xs max-h-[28rem] overflow-auto p-4 font-mono whitespace-pre-wrap">
                        {c.result.text}
                      </pre>
                    )}
                  </div>
                  {/* 外链统一走服务端 openExternal（ISSUE #3791）：桌面壳内
                      target=_blank 会被壳的 shell ACL 拦下（Runtime Error）。
                      对话测试（#4080）的产物是文本，没有「原链」可开。 */}
                  {c.result.kind !== "chat" && (
                    <div>
                      <Button
                        className="text-primary h-auto px-0 text-xs"
                        disabled={c.openBusy}
                        onClick={() => {
                          if (resultUrl !== null) {
                            void c.openResultInBrowser(resultUrl);
                          }
                        }}
                        size="sm"
                        variant="ghost"
                      >
                        打开原始产物（系统浏览器）
                      </Button>
                    </div>
                  )}
                </section>
              )}

              {/* 请求详情（ISSUE #3791；#3799：点生成即显示本地提交行 + 生成中
                  走秒 + 响应摘要默认格式化、可切原始；#3949 需求 4/8：生成前
                  显示「准备请求」、按模式 / 模型隔离、解释换算字段；#3995：
                  生成前同时可见「本地提交 + 实际请求」两行预览）。渲染收在
                  RequestDetailSection（§12.13 第二刀）。 */}
              {detailRows.length > 0 && (
                <RequestDetailSection
                  excerptPretty={excerptPretty}
                  generating={c.generating}
                  generatingSince={c.generatingSince}
                  onExcerptPretty={setExcerptPretty}
                  previewOnly={previewOnly}
                  rows={detailRows}
                />
              )}
            </>
          )}
        </div>
      </div>
    </DocumentFrame>
  );
}
