"use client";

/**
 * 「新建供应商」弹窗（规范 17 §17.2 第③层，#3501）。
 *
 * 只收供应商的连接参数（名称 / Base URL / API 格式 / API Key），校验与提交在
 * `use-provider-model-dialogs`（第②层），字段规则在 `~/lib/llm/provider-form`。
 * 编辑既有供应商走详情页的内联表单 —— 那里改完能立刻看到「最终请求地址」。
 */

import { Button } from "~/components/ui/button";
import { Dialog, DialogContent } from "~/components/ui/dialog";
import { FormField } from "~/components/ui/form-field";
import { Input } from "~/components/ui/input";
import { SelectMenu } from "~/components/ui/select-menu";
import { textHandler } from "~/lib/form-props";
import {
  LLM_API_FORMATS,
  LLM_API_FORMAT_LABELS,
  baseUrlVersionHint,
  requestUrlForFormat,
} from "~/lib/llm/provider-types";

import type { ProviderModelDialogs } from "../hooks/use-provider-model-dialogs";
import type { SettingsProviders } from "../hooks/use-settings-providers";

export function ProviderDialog({ d, p }: { d: ProviderModelDialogs; p: SettingsProviders }) {
  const finalUrl = requestUrlForFormat(d.providerForm.baseUrl, d.providerForm.apiFormat);
  const versionHint = baseUrlVersionHint(d.providerForm.baseUrl, d.providerForm.apiFormat);

  return (
    <Dialog
      onOpenChange={(next) => {
        if (!next) {
          d.closeProviderDialog();
        }
      }}
      open
    >
      <DialogContent
        aria-label="新建供应商"
        className="bg-transparent p-0 ring-0"
        popupClassName="max-w-md"
        showCloseButton={false}
      >
        <div className="border-border bg-surface w-full max-w-md rounded-2xl border p-5 shadow-2xl">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="u-title">新建供应商</h3>
            <Button
              aria-label="关闭"
              className="text-muted-foreground hover:text-ink"
              onClick={() => {
                d.closeProviderDialog();
              }}
              size="icon-sm"
              variant="ghost"
            >
              ✕
            </Button>
          </div>

          <FormField
            className="mb-3"
            error={d.providerErrors.name}
            id="provider-name"
            label="供应商名称"
            required
          >
            {(a11y) => (
              <Input
                {...a11y}
                className="border-border bg-surface-2 text-ink placeholder:text-muted-foreground/60 focus-visible:border-primary h-auto rounded-lg px-3 py-2 text-sm"
                onChange={textHandler((name) => {
                  d.setProviderForm((prev) => ({ ...prev, name }));
                })}
                placeholder="例如 Agnes / OpenAI / 自建网关"
                value={d.providerForm.name}
              />
            )}
          </FormField>

          <FormField
            className="mb-3"
            error={d.providerErrors.baseUrl}
            hint={
              finalUrl === "" ? (
                "填到版本段为止（如 https://api.example.com/v1），路径由接口格式补全"
              ) : (
                <span>
                  实际请求地址：<code className="text-ink/80">{finalUrl}</code>
                  {versionHint !== null && <span className="mt-0.5 block">{versionHint}</span>}
                </span>
              )
            }
            id="provider-base-url"
            label="Base URL"
            required
          >
            {(a11y) => (
              <Input
                {...a11y}
                className="border-border bg-surface-2 text-ink placeholder:text-muted-foreground/60 focus-visible:border-primary h-auto rounded-lg px-3 py-2 text-sm"
                onChange={textHandler((baseUrl) => {
                  d.setProviderForm((prev) => ({ ...prev, baseUrl }));
                })}
                placeholder="https://api.example.com/v1"
                value={d.providerForm.baseUrl}
              />
            )}
          </FormField>

          <FormField className="mb-3" id="provider-api-format" label="API 格式">
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
                    d.setProviderForm((prev) => ({ ...prev, apiFormat }));
                  }
                }}
                options={[...LLM_API_FORMATS]}
                popoverMinWidth={260}
                value={d.providerForm.apiFormat}
              />
            )}
          </FormField>

          <FormField
            className="mb-3"
            hint="留空则只依赖模型条目自己的密钥（也可稍后在内联详情里补）"
            id="provider-api-key"
            label="API Key"
          >
            {(a11y) => (
              <div className="flex gap-2">
                <Input
                  {...a11y}
                  className="border-border bg-surface-2 text-ink placeholder:text-muted-foreground/60 focus-visible:border-primary h-auto rounded-lg px-3 py-2 text-sm"
                  onChange={textHandler((apiKey) => {
                    d.setProviderForm((prev) => ({ ...prev, apiKey }));
                  })}
                  placeholder="sk-…"
                  type="password"
                  value={d.providerForm.apiKey}
                />
                <Button
                  className="text-muted-foreground h-auto shrink-0 rounded-lg px-3 py-2 text-sm"
                  disabled={d.providerTesting}
                  onClick={() => {
                    void d.testProviderDraft();
                  }}
                  variant="outline"
                >
                  {d.providerTesting ? "测试中…" : "测试连接"}
                </Button>
              </div>
            )}
          </FormField>

          {d.providerTestMsg && (
            <p
              className={`mb-3 rounded-lg px-3 py-2 text-xs ${
                d.providerTestMsg.kind === "ok"
                  ? "bg-success/10 text-success-strong"
                  : "bg-destructive/10 text-danger-strong"
              }`}
            >
              {d.providerTestMsg.text}
            </p>
          )}

          {d.providerError !== null && d.providerError !== "" && (
            <p className="bg-destructive/10 text-danger-strong mt-2 rounded-lg px-3 py-2 text-xs">
              {d.providerError}
            </p>
          )}

          <div className="mt-4 flex justify-end gap-2">
            <Button
              className="text-muted-foreground h-auto rounded-lg px-4 py-2 text-sm"
              onClick={() => {
                d.closeProviderDialog();
              }}
              variant="outline"
            >
              取消
            </Button>
            <Button
              className="h-auto rounded-lg px-4 py-2 text-sm font-semibold"
              disabled={p.busy}
              onClick={() => {
                void d.submitProvider();
              }}
            >
              {p.busy ? "保存中…" : "添加供应商"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
