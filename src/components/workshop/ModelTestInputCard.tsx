"use client";

import { Info, Play, SlidersHorizontal, TriangleAlert } from "lucide-react";

import { Button } from "~/components/ui/button";
import { Textarea } from "~/components/ui/textarea";
import { FormField } from "~/components/ui/form-field";
import { SelectChip } from "~/components/ui/select-chip";
import { TruncatedText } from "~/components/ui/truncated-text";
import type { WorkshopInputType } from "~/lib/workshop/remote-model-adapter";
import { cn } from "~/lib/utils";
import { serializeModelTestJson, type ModelTestControl } from "./model-test-config";
import { InputRow } from "./ModelTestInputRow";
import { ModelTestProgressPanel } from "./ModelTestProgressPanel";
import { ModelTestSizeField } from "./ModelTestSizeField";
import { ReferenceImageField, RequiredBadge } from "./ReferenceImageField";
import { SectionCard } from "./ModelTestSectionCard";
import type { useModelTest } from "./hooks/use-model-test";

type ModelTestController = ReturnType<typeof useModelTest>;

export function ModelTestInputCard({
  c,
  cancelled,
  jsonMode,
  jsonText,
  setJsonMode,
  setJsonText,
  sizeFromReference,
}: {
  c: ModelTestController;
  cancelled: boolean;
  jsonMode: boolean;
  jsonText: string;
  setJsonMode: (value: boolean) => void;
  setJsonText: (value: string) => void;
  sizeFromReference: boolean;
}) {
  const selectedAdapter = c.adapters.find((a) => a.mode === c.mode) ?? null;
  const mappedTypes = new Set<WorkshopInputType>(
    (selectedAdapter?.inputs ?? []).map((row) => row.type),
  );

  return (
    <SectionCard
      className="flex-1"
      hint="与工坊生成走同一份模式契约"
      icon={<SlidersHorizontal />}
      title={jsonMode ? "JSON 输入" : "统一输入"}
    >
      <div aria-label="输入方式" className="flex flex-wrap gap-2" role="radiogroup">
        <SelectChip
          onClick={() => {
            if (jsonMode && jsonText.trim() !== "") {
              const parsed = c.applyJsonValues(jsonText);
              if (!parsed.ok) {
                return;
              }
            }
            setJsonMode(false);
          }}
          selected={!jsonMode}
          shape="pill"
        >
          统一输入
        </SelectChip>
        <SelectChip
          onClick={() => {
            setJsonText(serializeModelTestJson(c.mode, c.values));
            setJsonMode(true);
          }}
          selected={jsonMode}
          shape="pill"
        >
          JSON 输入
        </SelectChip>
      </div>
      {jsonMode ? (
        <FormField
          hint="已按当前统一输入预填（含默认档）；直接改或粘贴历史「复制去重投」的 JSON，点「生成」或切回统一输入时按这里的参数应用；认不得的键会忽略"
          id="model-test-json"
          label="提交参数 JSON"
          labelClassName="mb-1.5"
        >
          {(a11y) => (
            <Textarea
              {...a11y}
              className="border-border bg-surface-1 focus:border-primary w-full resize-y rounded-lg border px-3 py-2 font-mono text-sm outline-none"
              onChange={(e) => {
                setJsonText(e.target.value);
              }}
              placeholder={
                '{\n  "mode": "T2I",\n  "inputs": {\n    "prompt": "…",\n    "seed": "…"\n  }\n}'
              }
              rows={12}
              spellCheck={false}
              value={jsonText}
            />
          )}
        </FormField>
      ) : (
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
                    <ModelTestSizeField
                      disabled={row.disabled}
                      mode={c.mode}
                      onPatchValues={c.patchValues}
                      referenceImageSrc={c.referenceImages[0]}
                      sizeFromReference={sizeFromReference}
                      values={c.values}
                    />
                  )}
                </FormField>
              );
            }
            const control: ModelTestControl = row.control;
            const id = `model-test-input-${row.id}`;
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
                  onError={c.showNotice}
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
                onError={c.showNotice}
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
      )}

      <div className="mt-2 flex flex-wrap items-center gap-3">
        <Button
          className="h-10 rounded-lg px-6"
          disabled={c.generating}
          onClick={() => {
            if (jsonMode) {
              const parsed = c.applyJsonValues(jsonText);
              if (!parsed.ok) {
                return;
              }
              setJsonMode(false);
              void c.generate(undefined, parsed.values);
              return;
            }
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

      <ModelTestProgressPanel
        generating={c.generating}
        progress={c.workflowProgress}
        since={c.generatingSince}
      />

      {c.error !== null && (
        <p
          className={cn(
            "flex items-start gap-1.5 rounded-lg px-3 py-2 text-xs leading-relaxed",
            cancelled ? "bg-warning/10 text-warning-strong" : "bg-destructive/10 text-destructive",
          )}
        >
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
    </SectionCard>
  );
}
