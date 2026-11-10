"use client";

/**
 * 「添加 / 编辑模型」弹窗（规范 17 §17.2 第③层，#3501）。
 *
 * 一条模型只声明「属于哪个供应商」+ 自己的窗口 / 输出上限 / 输入类型 / 能力 /
 * 推理映射；Base URL 与 API Key 属于供应商，不在这里重复填（历史行若带模型级
 * 接口覆盖，保存时原样保留，见 `modelSaveDraft`）。
 *
 * 交互态与提交在 `use-provider-model-dialogs`（第②层），字段规则在
 * `~/lib/llm/provider-form`（纯函数）。
 */

import { Button } from "~/components/ui/button";
import { Dialog, DialogContent } from "~/components/ui/dialog";
import { FieldLegend, FieldSet } from "~/components/ui/field";
import { FormField } from "~/components/ui/form-field";
import { Input } from "~/components/ui/input";
import { SelectMenu } from "~/components/ui/select-menu";
import { Switch } from "~/components/ui/switch";
import { Toggle } from "~/components/ui/toggle";
import { EMPTY_PLACEHOLDER } from "~/lib/display-value";
import { textHandler } from "~/lib/form-props";
import {
  MODEL_CAPABILITIES,
  MODEL_CAPABILITY_LABELS,
  MODEL_INPUT_TYPES,
  MODEL_INPUT_TYPE_LABELS,
  formatContextWindow,
} from "~/lib/llm/provider-types";
import { splitReasoningLevels } from "~/lib/llm/provider-form";
import { REMOTE_MODEL_KINDS, REMOTE_MODEL_KIND_LABELS } from "~/lib/llm/types";

import type { ModelDialog, ProviderModelDialogs } from "../hooks/use-provider-model-dialogs";
import type { SettingsProviders } from "../hooks/use-settings-providers";

export function ProviderModelDialog({
  d,
  dialog,
  p,
}: {
  d: ProviderModelDialogs;
  /** 非空由调用方保证：仅在弹窗打开时渲染。 */
  dialog: NonNullable<ModelDialog>;
  p: SettingsProviders;
}) {
  const providerId = dialog.mode === "add" ? dialog.providerId : dialog.model.providerId;
  const provider = p.providers.find((candidate) => candidate.id === providerId);
  const levels = splitReasoningLevels(d.modelForm.reasoningLevels);
  const windowPreview = formatContextWindow(Number(d.modelForm.contextWindow) || null);

  return (
    <Dialog
      onOpenChange={(next) => {
        if (!next) {
          d.closeModelDialog();
        }
      }}
      open
    >
      <DialogContent
        aria-label={dialog.mode === "edit" ? "编辑模型" : "添加模型"}
        className="bg-transparent p-0 ring-0"
        popupClassName="max-w-lg"
        showCloseButton={false}
      >
        <div className="border-border bg-surface max-h-[calc(100vh-4rem)] w-full max-w-lg overflow-y-auto rounded-2xl border p-5 shadow-2xl">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="u-title">{dialog.mode === "edit" ? "编辑模型" : "添加模型"}</h3>
              {provider && (
                <p className="text-muted-foreground text-2xs mt-0.5 truncate">
                  所属供应商：{provider.name}
                </p>
              )}
            </div>
            <Button
              aria-label="关闭"
              className="text-muted-foreground hover:text-ink shrink-0"
              onClick={() => {
                d.closeModelDialog();
              }}
              size="icon-sm"
              variant="ghost"
            >
              ✕
            </Button>
          </div>

          {/* 智能配置：按模型名推断窗口 / 输出上限 / 输入类型 / 能力。打开时
              改模型 ID 会自动重算；关掉则完全手填。 */}
          <div className="border-border bg-surface-row mb-3 flex items-center gap-3 rounded-lg border px-3 py-2.5">
            <div className="min-w-0 flex-1">
              <p className="text-ink text-sm font-medium">智能配置</p>
              <p className="text-muted-foreground text-2xs">
                按模型 ID 推断上下文窗口、输出上限与输入类型（可再手动调整）
              </p>
            </div>
            <Switch
              aria-label="智能配置"
              checked={d.modelForm.smartConfig}
              onCheckedChange={(checked) => {
                d.patchModelForm({ smartConfig: checked });
              }}
            />
          </div>

          <FormField
            className="mb-3"
            error={d.modelErrors.name}
            id="model-id"
            label="模型 ID"
            required
          >
            {(a11y) => (
              <Input
                {...a11y}
                className="border-border bg-surface-2 text-ink placeholder:text-muted-foreground/60 focus-visible:border-primary h-auto rounded-lg px-3 py-2 text-sm"
                onChange={textHandler((name) => {
                  d.patchModelForm({ name });
                })}
                placeholder="上游要求的模型名，例如 claude-sonnet-4-5 或 gpt-4o"
                value={d.modelForm.name}
              />
            )}
          </FormField>

          <FormField className="mb-3" id="model-kind" label="用途">
            {(a11y) => (
              <SelectMenu
                {...a11y}
                autoFitFromOptions={false}
                className="text-sm"
                fullWidth
                labels={REMOTE_MODEL_KIND_LABELS}
                onChange={(next) => {
                  const kind = REMOTE_MODEL_KINDS.find((candidate) => candidate === next);
                  if (kind !== undefined) {
                    d.patchModelForm({ kind });
                  }
                }}
                options={[...REMOTE_MODEL_KINDS]}
                popoverMinWidth={160}
                value={d.modelForm.kind}
              />
            )}
          </FormField>

          <div className="mb-3 grid grid-cols-2 gap-3">
            <FormField
              error={d.modelErrors.contextWindow}
              hint={windowPreview === EMPTY_PLACEHOLDER ? "留空 = 未知" : `约 ${windowPreview}`}
              id="model-context-window"
              label="上下文窗口"
            >
              {(a11y) => (
                <Input
                  {...a11y}
                  className="border-border bg-surface-2 text-ink placeholder:text-muted-foreground/60 focus-visible:border-primary h-auto rounded-lg px-3 py-2 text-sm"
                  inputMode="numeric"
                  onChange={textHandler((contextWindow) => {
                    d.patchModelForm({ contextWindow });
                  })}
                  placeholder="例如 200000"
                  value={d.modelForm.contextWindow}
                />
              )}
            </FormField>
            <FormField
              error={d.modelErrors.maxOutputTokens}
              hint="单次回答最多生成多少 token"
              id="model-max-output"
              label="最大输出 Token"
            >
              {(a11y) => (
                <Input
                  {...a11y}
                  className="border-border bg-surface-2 text-ink placeholder:text-muted-foreground/60 focus-visible:border-primary h-auto rounded-lg px-3 py-2 text-sm"
                  inputMode="numeric"
                  onChange={textHandler((maxOutputTokens) => {
                    d.patchModelForm({ maxOutputTokens });
                  })}
                  placeholder="例如 8192"
                  value={d.modelForm.maxOutputTokens}
                />
              )}
            </FormField>
          </div>

          <fieldset className="border-border mb-3 rounded-xl border p-3">
            <legend className="text-ink/80 px-1 text-sm font-medium">高级配置</legend>

            {/* 多选组没有单个控件能被 `htmlFor` 指到 ⇒ 用 `fieldset`/`legend` 给
                整组一个可访问名（`FormField` 的标签行只覆盖单控件形态）。 */}
            <FieldSet className="mb-3 gap-0">
              <FieldLegend className="text-ink/80 mb-1.5 text-sm" variant="label">
                输入类型
              </FieldLegend>
              <div className="flex flex-wrap gap-1.5">
                {MODEL_INPUT_TYPES.map((type) => (
                  <Toggle
                    className="h-auto rounded-lg border px-2.5 py-1 text-xs"
                    key={type}
                    onPressedChange={() => {
                      d.toggleInputType(type);
                    }}
                    pressed={d.modelForm.inputTypes.includes(type)}
                    size="sm"
                    variant="outline"
                  >
                    {MODEL_INPUT_TYPE_LABELS[type]}
                  </Toggle>
                ))}
              </div>
            </FieldSet>

            <FieldSet className="mb-3 gap-0">
              <FieldLegend className="text-ink/80 mb-1.5 text-sm" variant="label">
                模型能力
              </FieldLegend>
              <div className="flex flex-wrap gap-1.5">
                {MODEL_CAPABILITIES.map((capability) => (
                  <Toggle
                    className="h-auto rounded-lg border px-2.5 py-1 text-xs"
                    key={capability}
                    onPressedChange={() => {
                      d.toggleCapability(capability);
                    }}
                    pressed={d.modelForm.capabilities.includes(capability)}
                    size="sm"
                    variant="outline"
                  >
                    {MODEL_CAPABILITY_LABELS[capability]}
                  </Toggle>
                ))}
              </div>
            </FieldSet>

            <FormField
              className="mb-3"
              hint="逗号或空格分隔，例如 low, medium, high（各家叫法不同，不做白名单）"
              id="model-reasoning-levels"
              label="推理等级"
            >
              {(a11y) => (
                <Input
                  {...a11y}
                  className="border-border bg-surface-2 text-ink placeholder:text-muted-foreground/60 focus-visible:border-primary h-auto rounded-lg px-3 py-2 text-sm"
                  onChange={textHandler((reasoningLevels) => {
                    d.patchModelForm({ reasoningLevels });
                  })}
                  placeholder="low, medium, high"
                  value={d.modelForm.reasoningLevels}
                />
              )}
            </FormField>

            <FormField
              className="mb-2"
              hint="请求体里承接推理等级的字段名，例如 reasoning_effort 或 thinking.budget_tokens"
              id="model-reasoning-param"
              label="推理参数映射"
            >
              {(a11y) => (
                <Input
                  {...a11y}
                  className="border-border bg-surface-2 text-ink placeholder:text-muted-foreground/60 focus-visible:border-primary h-auto rounded-lg px-3 py-2 text-sm"
                  onChange={textHandler((reasoningParam) => {
                    d.patchModelForm({ reasoningParam });
                  })}
                  placeholder="reasoning_effort"
                  value={d.modelForm.reasoningParam}
                />
              )}
            </FormField>

            {levels.length === 0 ? (
              <p className="text-muted-foreground text-2xs">
                先在上面填推理等级，这里会为每个等级生成一行「等级 → 取值」。
              </p>
            ) : (
              <div className="flex flex-col gap-1.5">
                {levels.map((level) => (
                  <div className="flex items-center gap-2" key={level}>
                    <span className="text-muted-foreground w-20 shrink-0 truncate text-xs">
                      {level}
                    </span>
                    <Input
                      aria-label={`${level} 对应的取值`}
                      className="border-border bg-surface-2 text-ink placeholder:text-muted-foreground/60 focus-visible:border-primary h-auto rounded-lg px-2 py-1.5 text-sm"
                      onChange={textHandler((value) => {
                        d.patchModelForm({
                          reasoningValues: { ...d.modelForm.reasoningValues, [level]: value },
                        });
                      })}
                      placeholder="例如 high / 8192"
                      value={d.modelForm.reasoningValues[level] ?? ""}
                    />
                  </div>
                ))}
              </div>
            )}
          </fieldset>

          {d.modelError !== null && d.modelError !== "" && (
            <p className="bg-destructive/10 text-danger-strong mt-2 rounded-lg px-3 py-2 text-xs">
              {d.modelError}
            </p>
          )}

          <div className="mt-4 flex items-center justify-end gap-2">
            <Button
              className="text-muted-foreground mr-auto h-auto rounded-lg px-3 py-2 text-sm"
              onClick={() => {
                d.resetModelForm();
              }}
              variant="ghost"
            >
              重置
            </Button>
            <Button
              className="text-muted-foreground h-auto rounded-lg px-4 py-2 text-sm"
              onClick={() => {
                d.closeModelDialog();
              }}
              variant="outline"
            >
              取消
            </Button>
            <Button
              className="h-auto rounded-lg px-4 py-2 text-sm font-semibold"
              disabled={p.busy}
              onClick={() => {
                void d.submitModel();
              }}
            >
              {p.busy ? "保存中…" : "保存"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
