"use client";

/**
 * 供应商详情上半块：连接参数（名称 / Base URL / API Key）+ 自动保存提示 + 探测结论
 * （#3517 从 `ProviderDetail` 拆出，函数长度硬闸见规范 §12.13）。
 *
 * 这里只有展示与事件转发：草稿状态、校验、落库与探测都在 `ProviderDetail` 里
 * （再往上一层是 `use-settings-providers`）。拆开的判据是「输入全部来自 props」，
 * 所以它不持有任何自己的状态。
 */

import { Button } from "~/components/ui/button";
import { FormField } from "~/components/ui/form-field";
import { Input } from "~/components/ui/input";
import { textHandler } from "~/lib/form-props";
import type { ProviderFormErrors, ProviderFormValues } from "~/lib/llm/provider-form";

import type { ProviderView } from "../hooks/use-settings-providers";

/** 一次探测的展示态（供应商级）：成功 / 失败两种，文案由服务端归因后给出。 */
export type ProviderProbeMsg = { kind: "ok" | "err"; text: string } | null;

export function ProviderConnectionFields({
  error,
  errors,
  form,
  onClearKey,
  onCommit,
  onChange,
  onTest,
  onUndoClearKey,
  probeMsg,
  probing,
  provider,
  saveState,
}: {
  /** 落库失败 / 删除失败的统一错误位。 */
  error: string | null;
  errors: ProviderFormErrors;
  form: ProviderFormValues;
  /** 请求清除已保存的密钥（立刻落库，可撤销）。 */
  onClearKey: () => void;
  /** 失焦即保存：父级按「与库里那份有无差异」决定写不写。 */
  onCommit: () => void;
  onChange: (patch: Partial<ProviderFormValues>) => void;
  onTest: () => void;
  /** 撤销上一步的「清除密钥」（还没落库时）。 */
  onUndoClearKey: () => void;
  probeMsg: ProviderProbeMsg;
  probing: boolean;
  provider: ProviderView;
  saveState: "idle" | "saved" | "saving";
}) {
  const inputClass =
    "border-border bg-surface-2 text-ink placeholder:text-muted-foreground/60 focus-visible:border-primary h-auto rounded-lg px-3 py-2 text-sm";

  return (
    /* 这一块是**分组框**（供应商连接参数的外壳），不是「一行」：与卡片同底、
       只留一圈描边，靠内里的行（`bg-surface-row`）分层（ISSUE #3510 的口径）。 */
    <div className="border-border mb-4 rounded-xl border p-3">
      <FormField
        className="mb-3"
        error={errors.name}
        id="provider-detail-name"
        label="名称"
        required
      >
        {(a11y) => (
          <Input
            {...a11y}
            className={inputClass}
            onBlur={onCommit}
            onChange={textHandler((name) => {
              onChange({ name });
            })}
            value={form.name}
          />
        )}
      </FormField>

      <FormField
        className="mb-3"
        error={errors.baseUrl}
        hint="填到版本段为止（如 https://api.example.com/v1）；路径段由各模型的接口格式补全"
        id="provider-detail-base-url"
        label="Base URL"
        required
      >
        {(a11y) => (
          <Input
            {...a11y}
            className={inputClass}
            onBlur={onCommit}
            onChange={textHandler((baseUrl) => {
              onChange({ baseUrl });
            })}
            placeholder="https://api.example.com/v1"
            value={form.baseUrl}
          />
        )}
      </FormField>

      <FormField
        className="mb-2"
        hint={
          provider.hasApiKey
            ? "已保存密钥；留空保持不变，填新值则覆盖"
            : "留空 = 该供应商不附带密钥（模型条目可另带自己的）"
        }
        id="provider-detail-api-key"
        label="API Key"
      >
        {(a11y) => (
          <Input
            {...a11y}
            className={inputClass}
            onBlur={onCommit}
            onChange={(event) => {
              const apiKey = event.target.value;
              onChange({
                apiKey,
                ...(apiKey === "" ? {} : { clearApiKey: false }),
              });
            }}
            placeholder={provider.hasApiKey ? "已保存密钥，留空保持不变" : "sk-…"}
            type="password"
            value={form.apiKey}
          />
        )}
      </FormField>

      {provider.hasApiKey && form.apiKey === "" && (
        <p className="text-muted-foreground text-2xs mb-2">
          {form.clearApiKey ? (
            <>
              将清除该供应商的 API Key。
              <Button
                className="text-primary mx-1 h-auto p-0 underline underline-offset-2"
                onClick={onUndoClearKey}
                variant="link"
              >
                撤销
              </Button>
            </>
          ) : (
            <Button
              className="text-primary h-auto p-0 underline underline-offset-2"
              onClick={onClearKey}
              variant="link"
            >
              清除已保存的密钥
            </Button>
          )}
        </p>
      )}

      {probeMsg && (
        <p
          className={`mb-2 rounded-lg px-3 py-2 text-xs ${
            probeMsg.kind === "ok"
              ? "bg-success/10 text-success-strong"
              : "bg-destructive/10 text-danger-strong"
          }`}
        >
          {probeMsg.text}
        </p>
      )}

      {error !== null && error !== "" && (
        <p className="bg-destructive/10 text-danger-strong mb-2 rounded-lg px-3 py-2 text-xs">
          {error}
        </p>
      )}

      <div className="flex items-center justify-end gap-2">
        <span
          aria-live="polite"
          className={`text-2xs mr-auto ${
            saveState === "saved" ? "text-success-strong" : "text-muted-foreground"
          }`}
        >
          {saveState === "saving"
            ? "保存中…"
            : saveState === "saved"
              ? "已自动保存"
              : "字段失焦即自动保存"}
        </span>
        <Button
          className="text-muted-foreground h-auto rounded-lg px-3 py-2 text-sm"
          disabled={probing}
          onClick={onTest}
          variant="outline"
        >
          {probing ? "测试中…" : "测试连接"}
        </Button>
      </div>
    </div>
  );
}
