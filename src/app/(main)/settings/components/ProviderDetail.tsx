"use client";

/**
 * 供应商详情（规范 17 §17.2 第③层，#3501）：内联可编辑的连接参数 + 该供应商下的
 * 模型清单。
 *
 * 为什么详情是内联表单而不是又一个弹窗：用户对照截图里的「左列供应商、右列详情」
 * 心智模型改 Base URL / 格式 / 密钥，改完要能立刻看到「最终请求地址」；开弹窗会把
 * 这层对照关系挡掉。表单草稿是组件本地态，父级用 `key={provider.id}` 挂载 ——
 * 切供应商时整棵重建，不需要 effect 同步。
 *
 * 所有读写都经 `use-settings-providers`（第②层）与 `use-provider-model-dialogs`
 * （弹窗态）；本组件不直接发请求。
 */

import { useState } from "react";

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { ConfirmDialog } from "~/components/ui/confirm-dialog";
import { FormField } from "~/components/ui/form-field";
import { Hint } from "~/components/ui/hint";
import { Input } from "~/components/ui/input";
import { SelectMenu } from "~/components/ui/select-menu";
import { SETTINGS_ROW_CLASS } from "~/components/ui/settings-card";
import { Switch } from "~/components/ui/switch";
import { textHandler } from "~/lib/form-props";
import {
  LLM_API_FORMATS,
  LLM_API_FORMAT_LABELS,
  MODEL_INPUT_TYPE_LABELS,
  formatContextWindow,
  parseInputTypes,
  requestUrlForFormat,
} from "~/lib/llm/provider-types";
import {
  providerFormFromView,
  providerSaveDraft,
  validateProviderForm,
  type ProviderFormErrors,
} from "~/lib/llm/provider-form";
import { REMOTE_MODEL_KINDS, REMOTE_MODEL_KIND_LABELS } from "~/lib/llm/types";

import type { ProviderModelDialogs } from "../hooks/use-provider-model-dialogs";
import type {
  ProviderActionResult,
  ProviderView,
  SettingsProviders,
} from "../hooks/use-settings-providers";
import type { UsageTestDialogs } from "../hooks/use-usage-test-dialogs";

type ProbeMsg = { kind: "ok" | "err"; text: string } | null;

export function ProviderDetail({
  d,
  p,
  provider,
  usage,
}: {
  d: ProviderModelDialogs;
  p: SettingsProviders;
  provider: ProviderView;
  usage: UsageTestDialogs;
}) {
  const [form, setForm] = useState(() => providerFormFromView(provider));
  const [errors, setErrors] = useState<ProviderFormErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [probing, setProbing] = useState(false);
  const [probeMsg, setProbeMsg] = useState<ProbeMsg>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const models = p.models.filter((model) => model.providerId === provider.id);
  const finalUrl = requestUrlForFormat(form.baseUrl, form.apiFormat);

  async function saveProvider() {
    setError(null);
    const nextErrors = validateProviderForm(form);
    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      return;
    }
    setErrors({});
    const result = await p.saveProvider(providerSaveDraft(form, provider.id));
    if (!result.ok) {
      setError(result.error ?? "保存失败");
    }
  }

  /** 详情页「测试连接」：带上当前草稿（尚未保存的 Base URL / 格式 / 密钥也生效）；
   *  密钥留空时服务端按 `providerId` 取已保存值，浏览器始终拿不到明文。 */
  async function testProvider() {
    setProbing(true);
    setProbeMsg(null);
    try {
      const typedKey = form.apiKey.trim();
      const out = await p.probe({
        providerId: provider.id,
        baseUrl: form.baseUrl.trim() || undefined,
        apiFormat: form.apiFormat,
        ...(typedKey === "" ? {} : { apiKey: typedKey }),
      });
      setProbeMsg({ kind: out.ok ? "ok" : "err", text: out.detail });
    } finally {
      setProbing(false);
    }
  }

  async function runModelAction(action: Promise<ProviderActionResult>) {
    const result = await action;
    setError(result.ok ? null : (result.error ?? "操作失败"));
  }

  return (
    <div className="min-w-0">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="u-title truncate">供应商详情</h3>
        <Button
          className="text-muted-foreground hover:text-danger-strong text-2xs h-auto shrink-0 rounded px-2 py-0.5"
          onClick={() => {
            setConfirmDelete(true);
          }}
          size="xs"
          variant="outline"
        >
          删除供应商
        </Button>
      </div>

      {/* 这一块是**分组框**（供应商连接参数的外壳），不是「一行」：与卡片同底、
          只留一圈描边，靠内里的行（`bg-surface-row`）分层（ISSUE #3510 的口径）。 */}
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
              className="border-border bg-surface-2 text-ink placeholder:text-muted-foreground/60 focus-visible:border-primary h-auto rounded-lg px-3 py-2 text-sm"
              onChange={textHandler((name) => {
                setForm((prev) => ({ ...prev, name }));
              })}
              value={form.name}
            />
          )}
        </FormField>

        <FormField
          className="mb-3"
          error={errors.baseUrl}
          hint={
            finalUrl === "" ? (
              "填到版本段为止（如 https://api.example.com/v1），路径由接口格式补全"
            ) : (
              <span>
                实际请求地址：<code className="text-ink/80">{finalUrl}</code>
              </span>
            )
          }
          id="provider-detail-base-url"
          label="Base URL"
          required
        >
          {(a11y) => (
            <Input
              {...a11y}
              className="border-border bg-surface-2 text-ink placeholder:text-muted-foreground/60 focus-visible:border-primary h-auto rounded-lg px-3 py-2 text-sm"
              onChange={textHandler((baseUrl) => {
                setForm((prev) => ({ ...prev, baseUrl }));
              })}
              placeholder="https://platform.agnes-ai.com/v1"
              value={form.baseUrl}
            />
          )}
        </FormField>

        <FormField className="mb-3" id="provider-detail-api-format" label="API 格式">
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
                  setForm((prev) => ({ ...prev, apiFormat }));
                }
              }}
              options={[...LLM_API_FORMATS]}
              popoverMinWidth={260}
              value={form.apiFormat}
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
              className="border-border bg-surface-2 text-ink placeholder:text-muted-foreground/60 focus-visible:border-primary h-auto rounded-lg px-3 py-2 text-sm"
              onChange={(event) => {
                const apiKey = event.target.value;
                setForm((prev) => ({
                  ...prev,
                  apiKey,
                  ...(apiKey === "" ? {} : { clearApiKey: false }),
                }));
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
                保存后将清除该供应商的 API Key。
                <Button
                  className="text-primary mx-1 h-auto p-0 underline underline-offset-2"
                  onClick={() => {
                    setForm((prev) => ({ ...prev, clearApiKey: false }));
                  }}
                  variant="link"
                >
                  撤销
                </Button>
              </>
            ) : (
              <Button
                className="text-primary h-auto p-0 underline underline-offset-2"
                onClick={() => {
                  setForm((prev) => ({ ...prev, clearApiKey: true }));
                }}
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

        <div className="flex justify-end gap-2">
          <Button
            className="text-muted-foreground h-auto rounded-lg px-3 py-2 text-sm"
            disabled={probing}
            onClick={() => {
              void testProvider();
            }}
            variant="outline"
          >
            {probing ? "测试中…" : "测试连接"}
          </Button>
          <Button
            className="h-auto rounded-lg px-4 py-2 text-sm font-semibold"
            disabled={p.busy}
            onClick={() => {
              void saveProvider();
            }}
          >
            {p.busy ? "保存中…" : "保存"}
          </Button>
        </div>
      </div>

      <div className="border-border-subtle mb-2 flex items-center gap-2 border-b pb-1.5">
        <h3 className="u-title">模型列表</h3>
        <span className="text-ink-fainter text-2xs tabular-nums">{models.length}</span>
        <Button
          className="text-muted-foreground hover:text-ink text-2xs ml-auto h-auto rounded-md px-2 py-1"
          onClick={() => {
            d.openAddModel(provider.id);
          }}
          size="xs"
          variant="outline"
        >
          ＋ 添加模型
        </Button>
      </div>

      {models.length === 0 ? (
        <p className="text-muted-foreground text-2xs">
          这个供应商下还没有模型 —— 点「添加模型」加入模型 ID 与窗口配置。
        </p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {models.map((model) => {
            const thisProbe = d.modelProbe?.id === model.id ? d.modelProbe : null;
            const kind = REMOTE_MODEL_KINDS.find((candidate) => candidate === model.kind) ?? "chat";
            const inputTypes = parseInputTypes(model.inputTypes);
            return (
              <div className="flex-col gap-1" key={model.id}>
                <div className={`${SETTINGS_ROW_CLASS} flex items-center gap-2`}>
                  <Switch
                    aria-label={`${model.enabled ? "停用" : "启用"}模型 ${model.name}`}
                    checked={model.enabled}
                    disabled={p.busy}
                    onCheckedChange={(checked) => {
                      void runModelAction(p.toggleModel(model.id, checked));
                    }}
                    size="sm"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="text-ink truncate text-sm">{model.name}</span>
                      <Badge size="xs" tone="neutral">
                        {REMOTE_MODEL_KIND_LABELS[kind]}
                      </Badge>
                      {!model.enabled && (
                        <Badge size="xs" tone="warning">
                          已停用
                        </Badge>
                      )}
                    </div>
                    <p className="text-muted-foreground text-2xs truncate">
                      上下文 {formatContextWindow(model.contextWindow)} · 输出{" "}
                      {formatContextWindow(model.maxOutputTokens)}
                      {inputTypes.length > 0 &&
                        ` · ${inputTypes.map((type) => MODEL_INPUT_TYPE_LABELS[type]).join("/")}`}
                    </p>
                  </div>
                  <Hint label="按供应商配置探测接口连通性（不生成、不耗额度）" wrap>
                    <Button
                      className="text-muted-foreground text-2xs h-auto rounded px-1.5 py-0.5"
                      disabled={thisProbe?.running === true}
                      onClick={() => {
                        void d.testModel(model);
                      }}
                      size="xs"
                      variant="outline"
                    >
                      {thisProbe?.running === true ? "连接测试中…" : "测试连接"}
                    </Button>
                  </Hint>
                  <Hint label="按实际用法发起一次真实生成调用（参数可在弹窗内自定义）">
                    <Button
                      className="text-muted-foreground text-2xs h-auto rounded px-1.5 py-0.5"
                      onClick={() => {
                        usage.openUsageTest(kind, {
                          name: model.name,
                          kind,
                          baseUrl: model.baseUrl ?? provider.baseUrl,
                        });
                      }}
                      size="xs"
                      variant="outline"
                    >
                      测试生成
                    </Button>
                  </Hint>
                  <Hint label="编辑窗口 / 输入类型 / 模型能力 / 推理映射">
                    <Button
                      className="text-muted-foreground text-2xs h-auto rounded px-1.5 py-0.5"
                      onClick={() => {
                        d.openEditModel(model);
                      }}
                      size="xs"
                      variant="outline"
                    >
                      编辑
                    </Button>
                  </Hint>
                  <Hint label="移除该模型（即时保存）">
                    <Button
                      aria-label={`移除模型 ${model.name}`}
                      className="text-muted-foreground hover:text-danger-strong"
                      onClick={() => {
                        void runModelAction(p.deleteModel(model.id));
                      }}
                      size="icon-xs"
                      variant="ghost"
                    >
                      ✕
                    </Button>
                  </Hint>
                </div>
                {thisProbe?.msg && (
                  <div
                    className={`text-2xs mr-1 ml-1 rounded border px-2 py-1 ${
                      thisProbe.msg.kind === "ok"
                        ? "border-success/30 bg-success/10 text-success-strong"
                        : "border-destructive/30 bg-destructive/10 text-danger-strong"
                    }`}
                  >
                    {thisProbe.msg.text}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <ConfirmDialog
        confirmLabel="删除"
        danger
        description={`删除后，「${provider.name}」下的 ${String(models.length)} 个模型会一并移除，且无法恢复。`}
        onClose={() => {
          setConfirmDelete(false);
        }}
        onConfirm={() => {
          void (async () => {
            const result = await p.deleteProvider(provider.id);
            setConfirmDelete(false);
            if (!result.ok) {
              setError(result.error ?? "删除失败");
            }
          })();
        }}
        open={confirmDelete}
        pending={p.busy}
        title="删除供应商？"
      />
    </div>
  );
}
