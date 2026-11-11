"use client";

// ── 「测试模型能力」**视图**（规范 §17.2 第③层：只渲染 + 上抛）─────────────
// 用工坊同款通道直接试已配置的远端模型（#3590）：用途（图片 / 视频）→ 模型 →
// 模式 → 按「模型适配」里配的统一输入逐项填 → 生成 → 工坊同款产物展示。
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
import { pageHeaderTitle } from "~/components/studio/NavItems";
import { getWorkflowType } from "~/lib/workflow/workflow-types";
import { workshopInputLabel, type WorkshopInputType } from "~/lib/workshop/model-mode-contract";
import { cn } from "~/lib/utils";
import {
  ASPECT_RATIO_PRESETS,
  MEGAPIXEL_PRESETS,
  MODEL_TEST_KINDS,
  MODEL_TEST_KIND_LABELS,
  MULTIPLE_PRESETS,
  RELAY_INPUT_TYPES,
  controlForInputType,
  type ModelTestControl,
  type ModelTestKind,
} from "./model-test-config";
import { useModelTest } from "./hooks/use-model-test";

function modeLabel(mode: string): string {
  return getWorkflowType(mode)?.label ?? mode;
}

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

/** 一枚离散档位（比例 / 分辨率 / 数量共用）：role=radio + aria-checked 由
 *  `selected` 驱动（SelectChip 的约定），外层 radiogroup 给整组可访问名。 */
function PresetChip({
  label,
  onClick,
  selected,
}: {
  label: string;
  onClick: () => void;
  selected: boolean;
}) {
  return (
    <SelectChip onClick={onClick} selected={selected} shape="compact">
      {label}
    </SelectChip>
  );
}

/** 一行统一输入的渲染（按类型给控件；文案 = 输入类型的工坊名）。 */
function InputRow({
  control,
  disabled,
  hint,
  id,
  label,
  onChange,
  onPickFile,
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
  value: string;
}) {
  if (control === "prompt" || control === "negative") {
    return (
      <FormField hint={hint} id={id} label={label} labelClassName="mb-1.5">
        {(a11y) => (
          <textarea
            {...a11y}
            className={cn(
              "border-border bg-bg focus:border-primary w-full resize-y rounded-lg border px-3 py-2 text-sm outline-none",
              disabled && "opacity-50",
            )}
            disabled={disabled}
            onChange={(e) => {
              onChange(e.target.value);
            }}
            placeholder={control === "prompt" ? "描述你想要生成的画面" : "不想出现的内容（可留空）"}
            rows={control === "prompt" ? 3 : 2}
            value={value}
          />
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
  if (control === "ratio" || control === "megapixels" || control === "multiple") {
    const presets: ReadonlyArray<{ label: string; value: string }> =
      control === "ratio"
        ? ASPECT_RATIO_PRESETS.map((r) => ({ label: r, value: r }))
        : control === "megapixels"
          ? MEGAPIXEL_PRESETS
          : MULTIPLE_PRESETS.map((n) => ({ label: String(n), value: String(n) }));
    return (
      <FormField hint={hint} id={id} label={label} labelClassName="mb-1.5">
        {() => (
          <div aria-label={label} className="flex flex-wrap gap-1.5" role="radiogroup">
            {presets.map((p) => (
              <PresetChip
                key={p.value}
                label={p.label}
                onClick={() => {
                  onChange(p.value);
                }}
                selected={value === p.value}
              />
            ))}
          </div>
        )}
      </FormField>
    );
  }
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

  return (
    <DocumentFrame
      className="flex flex-col gap-6 px-4 pt-4 pb-8 sm:px-8 sm:pt-5 sm:pb-12"
      width="wide"
    >
      <PageHeader srTitle={pageHeaderTitle("model-test")} />

      {/* 用途 */}
      <section>
        <SectionLabel hint="同一模型的图片 / 视频分栏测试">用途</SectionLabel>
        <KindTabs kind={c.kind} onChange={c.setKind} />
      </section>

      {/* 模型 */}
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
          <div aria-label="选择模型" className="flex flex-wrap gap-2" role="radiogroup">
            {c.candidates.map((m) => (
              <SelectChip
                key={m.name}
                onClick={() => {
                  c.selectModel(m.name);
                }}
                selected={c.selectedModel === m.name}
                shape="pill"
              >
                {m.name}
              </SelectChip>
            ))}
          </div>
        )}
      </section>

      {c.selectedModel !== "" && (
        <>
          {/* 模式 */}
          <section>
            <SectionLabel hint="每种模式一份输入映射（在「模型适配」里配置）">模式</SectionLabel>
            {c.adapters.length === 0 ? (
              <p className="text-muted-foreground text-xs">
                该模型还没配模式适配器 —— 将按 OpenAI 兼容默认映射直连（生图
                /images/generations、视频 /videos）。要按接口字段精确适配，先到「模型适配」配置。
              </p>
            ) : (
              <SelectMenu
                aria-label="选择模式"
                autoFitFromOptions={false}
                className="text-sm"
                fullWidth={false}
                labels={Object.fromEntries(
                  c.adapters.map((a) => [a.mode, `${modeLabel(a.mode)}（${a.mode}）`]),
                )}
                onChange={c.setMode}
                options={c.adapters.map((a) => a.mode)}
                popoverMinWidth={220}
                value={c.mode}
              />
            )}
          </section>

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
              {inputRows.map((row, i) => {
                const control = controlForInputType(row.type);
                const id = `model-test-input-${row.type}`;
                const label = workshopInputLabel(row.type);
                const relayed = row.relayed;
                const hint = relayed
                  ? control === "ratio"
                    ? "统一输入 aspect-ratio 的取值，适配器按映射落字段"
                    : undefined
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
    </DocumentFrame>
  );
}
