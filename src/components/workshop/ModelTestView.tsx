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
import { useInterval } from "~/components/ui/use-interval";
import { MediaThumbnail } from "~/components/ui/media-thumbnail";
import { ViewableImage } from "~/components/ui/image-viewer";
import { PageHeader } from "~/components/ui/page-header";
import { SectionLabel } from "~/components/ui/section-label";
import { SelectChip } from "~/components/ui/select-chip";
import { SelectMenu } from "~/components/ui/select-menu";
import { pageHeaderTitle } from "~/components/studio/NavItems";
import { fixed } from "~/lib/number-format";
import { sceneFromMode } from "~/lib/media/size-presets";
import { ShotSizePicker } from "~/components/workshop/ShotSizePicker";
import type { WorkshopInputType } from "~/lib/workshop/remote-model-adapter";

import { cn } from "~/lib/utils";
import {
  MODEL_TEST_KINDS,
  MODEL_TEST_KIND_LABELS,
  sizeSpecToValues,
  sizeValuesToSpec,
  type ModelTestControl,
  type ModelTestKind,
  type ModelTestValues,
  type ModeTab,
} from "./model-test-config";
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

/** 生成中已过时间（ISSUE #3799）：本地 500ms 一跳，只重渲自己这格文本；
 *  生成结束后组件随行消失（行徽标换回「已发送」）。 */
function GeneratingElapsed({ since }: { since: number }) {
  const [now, setNow] = useState(() => Date.now());
  /* 走秒走 useInterval（P12：视图里不自写 setInterval）。 */
  useInterval(
    () => {
      setNow(Date.now());
    },
    { ms: 500 },
  );
  return <>进行中 {fixed((now - since) / 1000, 1)}s</>;
}

/** 响应摘要的格式化显示（ISSUE #3799）：结构化摘要默认 JSON 缩进；
 *  万一是字符串（历史读数）原样给出。 */
function prettyOrRaw(excerpt: unknown): string {
  if (typeof excerpt === "string") {
    return excerpt;
  }
  return JSON.stringify(excerpt, null, 2) ?? "";
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
      <span className="truncate">{label}</span>
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

export function ModelTestView() {
  const c = useModelTest();
  /* 响应摘要的显示形态（#3799）：默认格式化，可切回原始单行。 */
  const [excerptPretty, setExcerptPretty] = useState(true);

  const selectedAdapter = c.adapters.find((a) => a.mode === c.mode) ?? null;
  /* 适配器映射了的统一输入类型集合：契约行通道承接得住、但适配器没映射时，
   * 生成不会带上那个值 —— 行上明说，不静默丢（映射关系只在有适配器时存在）。 */
  const mappedTypes = new Set<WorkshopInputType>(
    (selectedAdapter?.inputs ?? []).map((row) => row.type),
  );
  /* 统一输入行来自模式契约（ISSUE #3778），行序 = 契约口序（ISSUE #3785）：
   * 复合尺寸口也在它契约里的位置上渲染，不整体前移。 */
  const modeLabel = c.modeTabs.find((t) => t.mode === c.mode)?.label ?? c.mode;
  /* 回调里读 c.result 会丢掉 JSX 条件的收窄 —— 先取一次稳定引用。 */
  const resultUrl = c.result?.url ?? null;

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
            <SectionLabel hint="「设置 → 远程模型」里启用的条目；按用途与所选模式过滤 —— 只列配了该模式适配器的模型">
              模型
            </SectionLabel>
            {c.loading ? (
              <p className="text-muted-foreground text-sm">加载中…</p>
            ) : c.candidates.length === 0 ? (
              c.kindCandidateCount === 0 ? (
                <p className="bg-warning/10 text-warning-strong rounded-lg px-3 py-2 text-xs">
                  还没有可测的{MODEL_TEST_KIND_LABELS[c.kind]}
                  模型 —— 到「设置 → 远程模型」添加并启用用途为{" "}
                  {c.kind === "image" ? "图像" : "视频"} 的条目。
                </p>
              ) : (
                <p className="bg-warning/10 text-warning-strong rounded-lg px-3 py-2 text-xs">
                  还没有模型配置「{modeLabel}
                  」模式的适配器（页签徽标的数字就是它的候选数）——
                  不支持这个模式的模型不会出现在下拉里；先到「模型适配」给模型添加该模式的适配器。
                </p>
              )
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
                            <span className="truncate">
                              {row.disabled ? `${row.label}（未承接）` : row.label}
                            </span>
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
                    ) : (
                      <MediaThumbnail
                        alt="生成结果"
                        as="video"
                        className="max-h-[28rem] w-full object-contain"
                        controls
                        src={c.result.url}
                      />
                    )}
                  </div>
                  {/* 外链统一走服务端 openExternal（ISSUE #3791）：桌面壳内
                      target=_blank 会被壳的 shell ACL 拦下（Runtime Error）。 */}
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
                </section>
              )}

              {/* 请求详情（ISSUE #3791；#3799：点生成即显示本地提交行 + 生成中
                  走秒 + 响应摘要默认格式化、可切原始）。 */}
              {c.debugRows.length > 0 && (
                <section className="flex flex-col gap-2">
                  <SectionLabel hint="本次生成实际发出的请求（密钥在请求头，不在此显示；请求体里的长值已截断）">
                    请求详情
                  </SectionLabel>
                  <div className="flex items-center gap-1.5">
                    <span className="text-muted-foreground text-2xs">响应摘要</span>
                    <SelectChip
                      onClick={() => {
                        setExcerptPretty(true);
                      }}
                      selected={excerptPretty}
                      shape="pill"
                    >
                      格式化
                    </SelectChip>
                    <SelectChip
                      onClick={() => {
                        setExcerptPretty(false);
                      }}
                      selected={!excerptPretty}
                      shape="pill"
                    >
                      原始
                    </SelectChip>
                  </div>
                  {c.debugRows.map((row, i) => (
                    <div
                      className="border-border bg-bg overflow-hidden rounded-lg border"
                      key={`${row.phase}-${String(i)}`}
                    >
                      <div className="flex flex-wrap items-center gap-2 px-3 py-2 text-xs">
                        {row.phase === "relay" ? (
                          /* 本地提交行（#3799）：点生成即出现；生成中走秒。 */
                          <span className="bg-primary/12 text-primary-strong text-2xs rounded-full px-2 py-0.5 tabular-nums">
                            {c.generating && c.generatingSince !== null ? (
                              <GeneratingElapsed since={c.generatingSince} />
                            ) : (
                              "已发送"
                            )}
                          </span>
                        ) : (
                          <span
                            className={cn(
                              "rounded-full px-2 py-0.5 text-2xs tabular-nums",
                              row.ok
                                ? "bg-elevated text-muted-foreground"
                                : "bg-destructive/10 text-destructive",
                            )}
                          >
                            {row.status === null ? "网络失败" : `HTTP ${String(row.status)}`}
                          </span>
                        )}
                        <span className="text-muted-foreground text-2xs">
                          {row.phase === "relay"
                            ? "本地提交"
                            : row.phase === "image"
                              ? "生图"
                              : row.phase === "video-submit"
                                ? "视频提交"
                                : "视频轮询"}
                        </span>
                        {row.durationMs !== null && (
                          <span className="text-muted-foreground text-2xs tabular-nums">
                            {String(row.durationMs)}ms
                          </span>
                        )}
                        <code className="min-w-0 flex-1 truncate font-mono">{row.endpoint}</code>
                      </div>
                      <pre className="border-border/60 text-2xs overflow-x-auto border-t px-3 py-2 font-mono break-all whitespace-pre-wrap">
                        {JSON.stringify(row.body, null, 2)}
                      </pre>
                      {row.excerpt !== null && row.excerpt !== undefined && (
                        <pre className="text-muted-foreground border-border/60 text-2xs overflow-x-auto border-t px-3 py-2 font-mono break-all whitespace-pre-wrap">
                          {excerptPretty
                            ? prettyOrRaw(row.excerpt)
                            : (JSON.stringify(row.excerpt) ?? "")}
                        </pre>
                      )}
                    </div>
                  ))}
                </section>
              )}
            </>
          )}
        </div>
      </div>
    </DocumentFrame>
  );
}
