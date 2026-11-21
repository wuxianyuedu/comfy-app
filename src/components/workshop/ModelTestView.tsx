"use client";

// ── 「测试模型能力」**视图**（规范 §17 第③层：只渲染 + 上抛）─────────────
// 三栏 Bento 布局：左栏 = 用途页签 → 模式列表（带候选模型数徽标，内部滚动）
// → 模型下拉（本地 / 远端分组）与通道提示；中栏 = 统一输入 + 生成 CTA +
// 进度 / 告警 + 执行日志；右栏 = 产物 / 请求与响应（ModelTestResultPanel）。
// 候选 / 适配器 / 契约 / 生成动作都在 `hooks/use-model-test.ts`（第②层）与
// `model-test-config.ts`（第①层）；本文件不出现 fetch / api.*。

import { useState } from "react";
import type { ReactNode } from "react";
import dynamic from "next/dynamic";
import {
  Boxes,
  Compass,
  Dices,
  Info,
  ListChecks,
  Play,
  Shapes,
  SlidersHorizontal,
  TriangleAlert,
} from "lucide-react";

import { Button } from "~/components/ui/button";
import { Skeleton } from "~/components/ui/skeleton";
import { DocumentFrame } from "~/components/studio/ViewContainer";
import { FilePickerButton } from "~/components/ui/file-picker";
import { FormField } from "~/components/ui/form-field";
import { Input } from "~/components/ui/input";
import { MediaThumbnail } from "~/components/ui/media-thumbnail";
import { PageHeader } from "~/components/ui/page-header";
import { Progress } from "~/components/ui/progress";
import { SelectChip } from "~/components/ui/select-chip";
import { TruncatedText } from "~/components/ui/truncated-text";
import { SelectMenu } from "~/components/ui/select-menu";
import { pageHeaderTitle } from "~/components/studio/NavItems";
import { clampInt } from "~/lib/clamp";
import { sceneFromMode } from "~/lib/media/size-presets";
import { ShotSizePicker } from "~/components/workshop/ShotSizePicker";
import type { QueueTaskLogTarget } from "~/components/studio/queue/QueueTaskLogModal";
import type { WorkshopInputType } from "~/lib/workshop/remote-model-adapter";

import { cn } from "~/lib/utils";
import {
  MODEL_TEST_KINDS,
  MODEL_TEST_KIND_LABELS,
  candidateValue,
  sizeSpecToValues,
  sizeValuesToSpec,
  type ModelTestControl,
  type ModelTestKind,
  type ModelTestValues,
  type ModeTab,
} from "./model-test-config";
import { ReferenceImageField, RequiredBadge } from "./ReferenceImageField";
import { useModelTest } from "./hooks/use-model-test";
import { LogsCard, ModelTestResultPanel } from "./ModelTestResultPanel";
import { TaskProgressPanel } from "./TaskProgressPanel";

/* 「大屏查看日志」弹窗：与历史记录 / 队列页同一份（QueueTaskLogModal 按 taskId
 * 直连 SSE）。dynamic 加载断开它携带的重依赖（react18-json-view 等），与
 * HistoryList 的接法同款。 */
const QueueTaskLogModal = dynamic(() =>
  import("~/components/studio/queue/QueueTaskLogModal").then((m) => m.QueueTaskLogModal),
);

type ModelTestController = ReturnType<typeof useModelTest>;

/** 卡片外壳：标题行（图标 + 名称 + 右侧弱化说明）+ 内容。 */
function Panel({
  children,
  className,
  hint,
  icon,
  title,
}: {
  children: ReactNode;
  className?: string;
  hint?: string;
  icon: ReactNode;
  title: string;
}) {
  return (
    <section
      className={cn(
        "flex flex-col gap-3 rounded-xl border border-border bg-surface p-4 shadow-sm",
        className,
      )}
    >
      <div className="flex items-center gap-1.5">
        <span className="text-primary-strong [&_svg]:size-3.5">{icon}</span>
        <span className="text-sm font-semibold">{title}</span>
        {hint !== undefined && hint !== "" && (
          <span className="text-2xs text-muted-foreground ml-auto font-normal">{hint}</span>
        )}
      </div>
      {children}
    </section>
  );
}

/** 用途页签（图片 / 视频 / 对话）：SelectChip 的 pill 单选组。 */
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

/** 左栏模式列表：当前用途下的**所有**生成类模式纵列，右侧徽标显示配了该
 *  模式适配器的候选模型数。选中态 = 品牌软底 + 描边；role=radio 由选中项
 *  驱动，外层 radiogroup 给整组可访问名。 */
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
                ? "bg-primary-soft ring-primary/25 text-primary-strong ring-1 hover:bg-primary-soft"
                : "bg-surface-1 ring-border/60 ring-1 hover:bg-subtle",
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
                  selected ? "text-primary-strong" : "text-ink",
                )}
              >
                {t.label}
              </TruncatedText>
              <span className="text-muted-foreground text-2xs block">{t.mode}</span>
            </span>
            <span
              className={cn(
                "shrink-0 rounded-full px-2 py-0.5 text-2xs tabular-nums",
                selected ? "bg-surface text-primary-strong" : "bg-subtle text-muted-foreground",
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

/** 尺寸：与工作流库**同一个**选择器（ShotSizePicker）。比例 / 像素（分辨率 ·
 *  百万像素）/ 倍数一段不缺，倍数段只在选中百万像素档时出现。表单值与
 *  SizeSpec 两套形状的换算在 model-test-config（全部走 size-presets 纯函数）。 */
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

/** 一行统一输入的渲染（按类型给控件；文案 = 契约口的展示名）。行标签右侧带
 *  必填 / 可选标识（来自契约 required）。尺寸复合口由 SizeField 统一承担。 */
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
  /** 提示词的随机按钮；给了才渲染。 */
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
                "border-border bg-surface-1 focus:border-primary w-full flex-1 resize-y rounded-lg border px-3 py-2 text-sm outline-none",
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
                <Dices className="size-3.5" data-icon="inline-start" />
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
  /* 分辨率档已并入 SizeField 的「像素」段（分辨率 · 百万像素两行）—— 这里
   * 不再有独立的分辨率 chips。duration / number / text → 单行输入。 */
  return (
    <FormField hint={hint} id={id} label={labelNode} labelClassName="mb-1.5">
      {(a11y) => (
        <Input
          {...a11y}
          className="border-border bg-surface-1 focus:border-primary h-auto w-48 rounded-lg px-3 py-2 text-sm"
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

/** 通道提示（选中模型后出现）：本地工作流走工坊本地通道；远端模型没配
 *  适配器时按 OpenAI 兼容默认映射直连。都是读数性质的信息条。 */
function ChannelNote({ c }: { c: ModelTestController }) {
  const selectedAdapter = c.adapters.find((a) => a.mode === c.mode) ?? null;
  const selectedWorkflow = c.selectedWorkflow;
  const modeLabel = c.modeTabs.find((t) => t.mode === c.mode)?.label ?? c.mode;
  let text: string | null = null;
  if (selectedWorkflow !== null) {
    text = selectedWorkflow.encapsulationReady
      ? "本地工作流模型：经工坊本地通道（ComfyUI）执行 —— 输入按模式契约落到工作流连线的端口上，未连线的口沿用工作流图内默认值。"
      : "本地工作流模型：该工作流还没有完成工坊封装（提示词口未连线），生成前先到工作流库「工坊封装」补线。";
  } else if (selectedAdapter === null && c.kind !== "chat") {
    text = `该模型没有「${modeLabel}」模式的适配器 —— 将按 OpenAI 兼容默认映射直连（生图 /images/generations、视频 /videos）。要按接口字段精确适配，先到「模型适配」配置。`;
  }
  if (text === null) {
    return null;
  }
  return (
    <p className="text-muted-foreground text-2xs flex items-start gap-1.5 leading-relaxed">
      <Info className="mt-0.5 size-3 shrink-0" />
      <span>{text}</span>
    </p>
  );
}

/** 空态引导（还没选模型时占住中栏）：三步指路，不出现任何网络 / 导航动作。 */
function OnboardingPanel({ c }: { c: ModelTestController }) {
  const kindLabel = MODEL_TEST_KIND_LABELS[c.kind];
  const steps = [
    "在左栏选用途与模式（当前：图片 / 视频 / 对话 分栏测试）",
    "从「模型」里挑一个候选 —— 本地模型来自工作流库，远端模型来自「设置 → 远程模型」",
    `填写提示词等统一输入，点「生成」查看${kindLabel}真实产物`,
  ];
  return (
    <Panel
      className="flex-1 items-center justify-center py-10"
      hint="与工坊生成走同一条通道"
      icon={<Compass />}
      title="选择一个模型开始测试"
    >
      <div className="flex flex-col items-center gap-1.5 text-center">
        <span className="bg-primary-soft text-primary-strong flex size-14 items-center justify-center rounded-full">
          <Compass className="size-7" />
        </span>
        <span className="mt-2 text-base font-semibold">三步跑通一次真实调用</span>
        <span className="text-muted-foreground max-w-md text-xs leading-relaxed">
          当前「{kindLabel}」用途下共有 {c.kindCandidateCount}{" "}
          个候选模型；选中后这里会展开统一输入表单。
        </span>
      </div>
      <ol className="mt-2 flex w-full max-w-md flex-col gap-2">
        {steps.map((step, i) => (
          <li
            className="border-border bg-surface-1 text-ink flex items-center gap-3 rounded-lg border px-4 py-2.5 text-left text-xs"
            key={step}
          >
            <span className="bg-subtle text-muted-foreground text-2xs flex size-5 shrink-0 items-center justify-center rounded-full font-bold tabular-nums">
              {i + 1}
            </span>
            {step}
          </li>
        ))}
      </ol>
    </Panel>
  );
}

export function ModelTestView() {
  const c = useModelTest();
  /* 响应摘要的显示形态：默认格式化，可切回原始单行。 */
  const [excerptPretty, setExcerptPretty] = useState(true);
  /* 「大屏查看日志」弹窗目标：存打开那一刻的快照（与 HistoryList 同款），
   * 生成态变化不重挂弹窗、不重订 SSE（#4743）。 */
  const [logTarget, setLogTarget] = useState<QueueTaskLogTarget | null>(null);
  const openLogScreen = () => {
    if (c.taskId === null || c.taskId === "") {
      return;
    }
    setLogTarget({
      id: c.taskId,
      /* 弹窗内的徽标会按 SSE 流自行翻面，这里只是打开那一刻的初值。 */
      status: c.generating ? "RUNNING" : c.error === null ? "SUCCEEDED" : "FAILED",
      workflowName: c.selectedWorkflow?.name ?? c.selectedModel,
    });
  };

  const selectedAdapter = c.adapters.find((a) => a.mode === c.mode) ?? null;
  /* 适配器映射了的统一输入类型集合：契约行通道承接得住、但适配器没映射时，
   * 生成不会带上那个值 —— 行上明说，不静默丢（映射关系只在有适配器时存在）。 */
  const mappedTypes = new Set<WorkshopInputType>(
    (selectedAdapter?.inputs ?? []).map((row) => row.type),
  );
  const modeLabel = c.modeTabs.find((t) => t.mode === c.mode)?.label ?? c.mode;
  const hasModel = c.selectedModel !== "";

  return (
    <DocumentFrame className="flex flex-col gap-5 px-4 pt-4 pb-10 sm:px-6 sm:pt-5" width="full">
      <PageHeader srTitle={pageHeaderTitle("model-test")} />

      <div className="flex flex-col gap-4 xl:flex-row xl:items-start">
        {/* ── 左栏：用途 + 模式 + 模型（模式列表有滚动上限，不会把模型卡挤走；
            桌面下吸附成独立滚动区）── */}
        <aside className="flex w-full shrink-0 flex-col gap-4 xl:sticky xl:top-4 xl:max-h-[calc(100dvh-96px)] xl:w-64 xl:overflow-y-auto">
          <Panel icon={<Shapes />} title="用途">
            <KindTabs kind={c.kind} onChange={c.setKind} />
          </Panel>

          {c.modeTabs.length > 0 && (
            <Panel icon={<ListChecks />} title="模式">
              <div className="max-h-80 overflow-y-auto pr-0.5">
                <ModeTabs mode={c.mode} onSelect={c.setMode} tabs={c.modeTabs} />
              </div>
            </Panel>
          )}

          <Panel hint="按用途与模式过滤" icon={<Boxes />} title="模型">
            {c.loading ? (
              /* 骨架屏（ISSUE #4749）：与模型列表条目同形的占位条。 */
              <div aria-label="加载中" className="flex flex-col gap-2" role="status">
                {[0, 1, 2].map((i) => (
                  <Skeleton className="h-9 w-full rounded-lg" key={i} />
                ))}
              </div>
            ) : c.candidates.length === 0 ? (
              c.kindCandidateCount === 0 ? (
                <p className="bg-warning/10 text-warning-strong rounded-lg px-3 py-2 text-xs leading-relaxed">
                  {c.kind === "chat"
                    ? "还没有可测的对话模型 —— 本地模型到「设置 → 本地模型」添加 Ollama 候选；远端模型到「设置 → 远程模型」添加用途为 对话 的条目。"
                    : `还没有可测的${MODEL_TEST_KIND_LABELS[c.kind]}模型 —— 本地模型到工作流库导入${
                        c.kind === "image" ? "生图" : "视频"
                      }工作流（工坊封装就绪后出现在这里）；远端模型到「设置 → 远程模型」添加并启用用途为 ${
                        c.kind === "image" ? "图像" : "视频"
                      } 的条目。`}
                </p>
              ) : (
                <p className="bg-warning/10 text-warning-strong rounded-lg px-3 py-2 text-xs leading-relaxed">
                  当前「{modeLabel}」模式下没有可用模型（页签徽标的数字就是它的候选数）——
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
                /* 本地 / 远端分组：对话的本地 = Ollama 候选；图片 / 视频的
                 * 本地 = 工作流库工作流，远端 = 设置页配置的远端模型。 */
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
                labels={c.candidateLabels}
                onChange={c.selectModel}
                options={c.candidates.map(candidateValue)}
                placeholder="选择要测试的模型…"
                popoverMinWidth={240}
                value={c.selectedModel}
              />
            )}
            {hasModel && <ChannelNote c={c} />}
          </Panel>
        </aside>

        {/* ── 中栏：统一输入 + 生成 CTA（未选模型时给三步引导）── */}
        <div className="flex min-w-0 flex-1 flex-col gap-4">
          {hasModel ? (
            <>
              <Panel
                className="flex-1"
                hint="与工坊生成走同一份模式契约"
                icon={<SlidersHorizontal />}
                title="统一输入"
              >
                <div className="flex flex-col gap-4">
                  {c.inputRows.map((row, i) => {
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
                    /* 通道承接得住、但适配器没映射 → 提示「生成不会带上」。 */
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
                </div>

                {/* 生成（生成中可取消；对话用途是「发送」） */}
                <div className="mt-2 flex flex-wrap items-center gap-3">
                  <Button
                    className="h-10 rounded-lg px-6"
                    disabled={c.generating}
                    onClick={() => {
                      void c.generate();
                    }}
                    variant="primary-solid"
                  >
                    <Play className="size-4" data-icon="inline-start" />
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
                      className="h-10 rounded-lg px-4"
                      onClick={() => {
                        c.cancelGenerate();
                      }}
                      variant="outline"
                    >
                      {c.kind === "chat" ? "取消发送" : "取消生成"}
                    </Button>
                  )}
                  <span className="text-2xs text-muted-foreground">
                    {c.kind === "chat"
                      ? "真实调用被测模型 —— 本地模型走设置里配置的本地服务，远端模型按名直连。"
                      : c.selectedWorkflow === null
                        ? "真实调用，按上游计费 —— 与工坊生成走同一条通道。"
                        : "真实运行本地工作流 —— 与工坊生成走同一条本地通道（ComfyUI）。"}
                  </span>
                </div>

                {/* 本地工作流任务的实时进度：SSE state 帧，整百分比变化才更新。 */}
                {c.generating && c.workflowProgress !== null && (
                  <div
                    className="border-border bg-surface-1 rounded-lg border px-4 py-3"
                    role="status"
                  >
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-medium">
                        本地工作流执行进度
                        {c.workflowProgress.label !== undefined && c.workflowProgress.label !== ""
                          ? ` · ${c.workflowProgress.label}`
                          : ""}
                      </span>
                      <span className="text-primary-strong font-semibold tabular-nums">
                        {Math.floor(c.workflowProgress.pct)}%
                      </span>
                    </div>
                    <Progress
                      className="mt-2"
                      value={clampInt(Math.floor(c.workflowProgress.pct), 2, 100)}
                    />
                  </div>
                )}

                {c.error !== null && (
                  <p className="bg-destructive/10 text-destructive flex items-start gap-1.5 rounded-lg px-3 py-2 text-xs leading-relaxed">
                    <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
                    <span>{c.error}</span>
                  </p>
                )}

                {c.notice !== null && (
                  <p
                    className={cn(
                      "flex items-start gap-1.5 rounded-lg px-3 py-2 text-xs leading-relaxed",
                      c.notice.kind === "ok"
                        ? "bg-subtle text-muted-foreground"
                        : "bg-destructive/10 text-destructive",
                    )}
                  >
                    <Info className="mt-0.5 size-3.5 shrink-0" />
                    <span>{c.notice.text}</span>
                  </p>
                )}
              </Panel>

              {/* 分节点进度可视化：解析执行日志里的 comfy-cli progress/executing
                  事件按节点出条（#4743）；无进度事件（对话 / API 中继）不渲染。 */}
              <TaskProgressPanel logs={c.taskLogs} />

              {/* 执行日志放中栏：紧贴生成动作（进度 → 日志），列宽也容得下
                  等宽字体行，不再挤在窄右栏里 */}
              <LogsCard
                logs={c.taskLogs}
                onOpenScreen={c.taskId === null ? undefined : openLogScreen}
              />
            </>
          ) : (
            <OnboardingPanel c={c} />
          )}
        </div>

        {/* ── 右栏：产物 / 请求与响应（选中模型后才出现）── */}
        {hasModel && (
          <ModelTestResultPanel
            c={c}
            excerptPretty={excerptPretty}
            onExcerptPretty={setExcerptPretty}
          />
        )}
      </div>

      {/* 大屏查看日志弹窗（与历史记录 / 队列页同一份；task 为 null 时不渲染）。 */}
      <QueueTaskLogModal
        onClose={() => {
          setLogTarget(null);
        }}
        task={logTarget}
      />
    </DocumentFrame>
  );
}
