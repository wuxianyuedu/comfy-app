"use client";

/**
 * 「添加 / 编辑模型」弹窗（规范 17 §17.2 第③层，#3501）。
 *
 * 一条模型声明「属于哪个供应商」+ 自己的**接口格式** / 窗口 / 输出上限 / 输入类型 /
 * 能力 / 推理映射；Base URL 与 API Key 属于供应商，不在这里重复填（历史行若带模型级
 * 接口覆盖，保存时原样保留，见 `modelSaveDraft`）。
 *
 * 接口格式为什么在模型上（#3517）：同一供应商下文本 / 图片 / 视频模型可能各用一套
 * 协议（`chat/completions` vs `responses` vs `v1/messages`），供应商级只有一个选择时
 * 必然有一条链探不通。弹窗把「格式 + 供应商 Base URL」拼出的最终请求地址直接显示，
 * 用户不用心算路径段。
 *
 * 图像 / 视频模型按用途分叉渲染（#3618 补充）：它们的「API 格式」下拉、
 * 智能配置、上下文窗口 / 输出上限、高级配置这些文本协议的配置全部不出现，
 * 换成按用途给词表的「接口端点」下拉（#3656：词表 `REMOTE_MEDIA_ENDPOINT_OPTIONS`，
 * 落库在模型级适配器存档 `RemoteModelAdaptersDoc.endpointPath`（#3622/#3659 的
 * 同一份存储）；没选 = 用途默认第一项，最终请求地址在提示里展示）。
 *
 * 交互态与提交在 `use-provider-model-dialogs`（第②层），字段规则在
 * `~/lib/llm/provider-form`（纯函数）。
 */

import { useState } from "react";

import { ChevronDownIcon } from "lucide-react";
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
  LLM_API_FORMATS,
  LLM_API_FORMAT_LABELS,
  MODEL_CAPABILITIES,
  MODEL_CAPABILITY_LABELS,
  MODEL_INPUT_TYPES,
  MODEL_INPUT_TYPE_LABELS,
  MODEL_OUTPUT_TYPES,
  MODEL_OUTPUT_TYPE_LABELS,
  REMOTE_MEDIA_ENDPOINT_OPTIONS,
  formatContextWindow,
  joinApiUrl,
  requestUrlForFormat,
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
  const providerBaseUrl = provider?.baseUrl ?? "";
  const requestUrl = requestUrlForFormat(providerBaseUrl, d.modelForm.apiFormat);
  /* 图像 / 视频（#3656）：「接口端点」是下拉（词表 `REMOTE_MEDIA_ENDPOINT_OPTIONS`，
   * 生效值在表单里，库里没配 = 用途默认第一项）；这里只拼最终地址做提示展示。 */
  const isChat = d.modelForm.kind === "chat";
  const mediaOptions: ReadonlyArray<string> =
    d.modelForm.kind === "chat" ? [] : REMOTE_MEDIA_ENDPOINT_OPTIONS[d.modelForm.kind];
  /* 选项标签 = 按 Base URL 拼出的最终请求地址；Base 还没填时给路径段本身
   * （joinApiUrl 对空 Base 返回空串，直接拼会只剩一个光秃秃的 POST）。 */
  const mediaEndpointLabels: Record<string, string> = Object.fromEntries(
    mediaOptions.map((path) => [
      path,
      `POST ${providerBaseUrl === "" ? path : joinApiUrl(providerBaseUrl, path)}`,
    ]),
  );
  const mediaEndpointUrl =
    !isChat && d.modelForm.endpointPath !== ""
      ? joinApiUrl(providerBaseUrl, d.modelForm.endpointPath)
      : "";
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
        {/* 高度封顶要给上沿留出空隙（#3618 已落在 master，本分支沿用同一解）：
            弹窗居中定位，内容顶到 `100vh-4rem` 时上下只剩 1rem，顶部被
            3rem 的顶栏吃掉后看起来「顶着窗口上沿」；收到 `100vh-12rem`
            后上下各保底 5rem。 */}
        <div className="border-border bg-surface max-h-[calc(100vh-12rem)] w-full max-w-lg overflow-y-auto rounded-2xl border p-5 shadow-2xl">
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
              改模型 ID 会自动重算；关掉则完全手填。仅文本模型（#3618 补充）：
              图像 / 视频模型没有窗口 / 输出上限这些配置项。 */}
          {isChat && (
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
          )}

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
                    /* 用途切换连带端点词表换一套（#3656）：生效路径回到新用途的
                     * 默认第一项，旧用途选中的路径不该带到新用途上。 */
                    d.patchModelForm({
                      kind,
                      endpointPath:
                        kind === "chat" ? "" : (REMOTE_MEDIA_ENDPOINT_OPTIONS[kind][0] ?? ""),
                    });
                  }
                }}
                options={[...REMOTE_MODEL_KINDS]}
                popoverMinWidth={160}
                value={d.modelForm.kind}
              />
            )}
          </FormField>

          {isChat ? (
            <FormField
              className="mb-3"
              hint={
                providerBaseUrl === "" ? (
                  "所属供应商还没有 Base URL：先在供应商详情里填好，这里会显示最终请求地址"
                ) : (
                  <span>
                    实际请求地址：<code className="text-ink/80">{requestUrl}</code>
                  </span>
                )
              }
              id="model-api-format"
              label="API 格式"
            >
              {(a11y) => (
                <SelectMenu
                  {...a11y}
                  autoFitFromOptions={false}
                  className="text-sm"
                  fullWidth
                  labels={LLM_API_FORMAT_LABELS}
                  onChange={(next) => {
                    const apiFormat = LLM_API_FORMATS.find((format) => format === next);
                    if (apiFormat !== undefined) {
                      d.patchModelForm({ apiFormat });
                    }
                  }}
                  options={[...LLM_API_FORMATS]}
                  popoverMinWidth={260}
                  value={d.modelForm.apiFormat}
                />
              )}
            </FormField>
          ) : (
            /* 图像 / 视频（#3656）：没有文本协议的「API 格式」下拉 —— 三种文本
             * 格式对图像 / 视频端点都无意义。「接口端点」按用途给下拉（词表
             * `REMOTE_MEDIA_ENDPOINT_OPTIONS`），没选 = 第一项（生效值在表单里，
             * 打开弹窗就已带上），下方提示展示按 Base URL 拼出的最终请求地址。 */
            <FormField
              className="mb-3"
              hint={
                providerBaseUrl === "" ? (
                  "所属供应商还没有 Base URL：先在供应商详情里填好，这里会显示最终请求地址"
                ) : (
                  <span>
                    实际请求地址：<code className="text-ink/80">{mediaEndpointUrl}</code>
                  </span>
                )
              }
              id="model-endpoint"
              label="接口端点"
            >
              {(a11y) => (
                <SelectMenu
                  {...a11y}
                  autoFitFromOptions={false}
                  className="text-sm"
                  fullWidth
                  labels={mediaEndpointLabels}
                  onChange={(next) => {
                    d.patchModelForm({ endpointPath: next });
                  }}
                  options={[...mediaOptions]}
                  popoverMinWidth={320}
                  value={d.modelForm.endpointPath}
                />
              )}
            </FormField>
          )}

          {isChat && (
            <div className="mb-3 grid grid-cols-2 gap-3">
              <FormField
                error={d.modelErrors.contextWindow}
                hint={
                  windowPreview === EMPTY_PLACEHOLDER
                    ? "常见文本模型 128K～1M；留空 = 未知"
                    : `约 ${windowPreview}`
                }
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
          )}

          {isChat && <ModelAdvancedFieldset d={d} defaultOpen={dialog.mode === "edit"} />}

          {d.modelError !== null && d.modelError !== "" && (
            <p className="bg-destructive/10 text-danger-strong mt-2 rounded-lg px-3 py-2 text-xs">
              {d.modelError}
            </p>
          )}

          <div className="mt-4 flex items-center justify-end gap-2">
            <Button
              className="text-muted-foreground dark:text-ink hover:bg-surface-2/80 dark:hover:bg-ink/30 bg-surface-2 dark:bg-ink/25 dark:border-ink/40 mr-auto h-auto rounded-lg px-3 py-2 text-sm"
              onClick={() => {
                d.resetModelForm();
              }}
              variant="outline"
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

/** 「高级配置」折叠块（#3577 可折叠；编辑既有模型默认展开）。#3618 起只服务
 *  文本模型：图像 / 视频模型没有输入 / 输出类型、能力、推理映射这些文本协议
 *  的配置项。从主函数拆出来（规范 §12.13 函数长度硬闸：整块 JSX 挂在主函数
 *  上把它顶过了 400 行）。 */
function ModelAdvancedFieldset({
  d,
  defaultOpen,
}: {
  d: ProviderModelDialogs;
  defaultOpen: boolean;
}) {
  const [advancedOpen, setAdvancedOpen] = useState(defaultOpen);
  const levels = splitReasoningLevels(d.modelForm.reasoningLevels);
  return (
    <fieldset className="border-border mb-3 rounded-xl border p-3">
      {/* 折叠头（#3577）：整个头部是按钮，点击展开 / 收起；箭头随态旋转。
      用 ui/button 的 <Button> —— 视图层手写 <button> 是基元棘轮 P1。 */}
      <Button
        aria-expanded={advancedOpen}
        className="text-ink/80 hover:text-ink -mx-1 h-auto rounded px-1 py-0.5 text-sm font-medium"
        onClick={() => {
          setAdvancedOpen((prev) => !prev);
        }}
        variant="ghost"
      >
        <ChevronDownIcon
          aria-hidden
          className={`size-3.5 transition-transform ${advancedOpen ? "" : "-rotate-90"}`}
          data-icon="inline-start"
        />
        高级配置
      </Button>

      {advancedOpen && (
        <>
          {/* 多选组没有单个控件能被 `htmlFor` 指到 ⇒ 用 `fieldset`/`legend` 给
      整组一个可访问名（`FormField` 的标签行只覆盖单控件形态）。 */}
          <FieldSet className="mt-3 mb-3 gap-0">
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
                  variant="chip"
                >
                  {MODEL_INPUT_TYPE_LABELS[type]}
                </Toggle>
              ))}
            </div>
          </FieldSet>

          <FieldSet className="mb-3 gap-0">
            <FieldLegend className="text-ink/80 mb-1.5 text-sm" variant="label">
              输出类型
            </FieldLegend>
            <div className="flex flex-wrap gap-1.5">
              {MODEL_OUTPUT_TYPES.map((type) => (
                <Toggle
                  className="h-auto rounded-lg border px-2.5 py-1 text-xs"
                  key={type}
                  onPressedChange={() => {
                    d.toggleOutputType(type);
                  }}
                  pressed={d.modelForm.outputTypes.includes(type)}
                  size="sm"
                  variant="chip"
                >
                  {MODEL_OUTPUT_TYPE_LABELS[type]}
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
                  variant="chip"
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
        </>
      )}
    </fieldset>
  );
}
