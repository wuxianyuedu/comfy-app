"use client";

/**
 * 供应商详情（规范 17 §17.2 第③层，#3501）：内联可编辑的连接参数 + 该供应商下的
 * 模型清单。
 *
 * 为什么详情是内联表单而不是又一个弹窗：用户对照截图里的「左列供应商、右列详情」
 * 心智模型改 Base URL / 密钥；开弹窗会把这层对照关系挡掉。表单草稿是组件本地态，
 * 父级用 `key={provider.id}` 挂载 —— 切供应商时整棵重建，不需要 effect 同步。
 *
 * #3517 起**没有「保存」按钮**：字段失焦即落库（判据是「与库里那份有无差异」，
 * 无差异不写）。最容易出事的顺序是「改完 Base URL 直接点测试连接」—— 有保存按钮时
 * 用户会忘了点，探测拿的是旧地址，界面于是自相矛盾。接口格式也不再属于供应商，
 * 而是模型级配置（同一供应商下文本 / 图片 / 视频模型可能各用一套协议）。
 *
 * 本组件只留「草稿状态 + 落库 / 探测」这一层：连接参数那一块与一行模型各自的
 * JSX 都在同目录的子组件里（函数长度硬闸，规范 §12.13）。所有读写都经
 * `use-settings-providers`（第②层）与 `use-provider-model-dialogs`（弹窗态）；
 * 本组件不直接发请求。
 */

import { useState } from "react";

import { Button } from "~/components/ui/button";
import { ConfirmDialog } from "~/components/ui/confirm-dialog";
import {
  providerFormFromView,
  providerSaveDraft,
  validateProviderForm,
  type ProviderFormErrors,
  type ProviderFormValues,
} from "~/lib/llm/provider-form";

import type { ProviderModelDialogs } from "../hooks/use-provider-model-dialogs";
import type {
  ProviderActionResult,
  ProviderView,
  SettingsProviders,
} from "../hooks/use-settings-providers";
import type { UsageTestDialogs } from "../hooks/use-usage-test-dialogs";

import { ProviderConnectionFields, type ProviderProbeMsg } from "./ProviderConnectionFields";
import { ProviderModelRow } from "./ProviderModelRow";

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
  const [saveState, setSaveState] = useState<"idle" | "saved" | "saving">("idle");
  const [probing, setProbing] = useState(false);
  const [probeMsg, setProbeMsg] = useState<ProviderProbeMsg>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const models = p.models.filter((model) => model.providerId === provider.id);

  /** 受控输入的统一更新口：改字就把「已保存」提示收回去（它只对上一次提交成立）。 */
  function updateForm(patch: Partial<ProviderFormValues>) {
    setSaveState("idle");
    setForm((prev) => ({ ...prev, ...patch }));
  }

  /** 失焦即保存（#3517）：详情页不再有「保存」按钮 —— 用户改完 Base URL 直接点
   *  「测试连接」时，最容易发生的正是忘了保存、拿旧地址去探。
   *  判据是「与库里那份有没有差异」：没有差异就不写库（切个焦点不该产生写操作）；
   *  字段不合法时只报错、不写库（半截地址落库比不保存更难查）。 */
  async function commit(next: ProviderFormValues = form) {
    const nextErrors = validateProviderForm(next);
    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      return;
    }
    setErrors({});
    const draft = providerSaveDraft(next, provider.id);
    if (
      draft.name === provider.name &&
      draft.baseUrl === provider.baseUrl &&
      draft.apiKey === undefined
    ) {
      return;
    }
    setError(null);
    setSaveState("saving");
    const result = await p.saveProvider(draft);
    if (!result.ok) {
      setSaveState("idle");
      setError(result.error ?? "保存失败");
      return;
    }
    setSaveState("saved");
    /* 密钥写进去之后立刻清空输入框：明文只该在这次提交里存在，留在框里会让
     * 「已保存密钥；留空保持不变」的提示与画面自相矛盾。 */
    if (draft.apiKey !== undefined) {
      setForm((prev) => ({ ...prev, apiKey: "", clearApiKey: false }));
    }
  }

  /** 详情页「测试连接」：带上当前草稿（尚未保存的 Base URL / 密钥也生效）；
   *  密钥留空时服务端按 `providerId` 取已保存值，浏览器始终拿不到明文。
   *  接口格式由服务端按「该供应商下各模型用到的格式」逐个试（#3517）。 */
  async function testProvider() {
    setProbing(true);
    setProbeMsg(null);
    try {
      const typedKey = form.apiKey.trim();
      const out = await p.probe({
        providerId: provider.id,
        baseUrl: form.baseUrl.trim() || undefined,
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

      <ProviderConnectionFields
        error={error}
        errors={errors}
        form={form}
        onClearKey={() => {
          const next = { ...form, clearApiKey: true };
          setForm(next);
          void commit(next);
        }}
        onCommit={() => {
          void commit();
        }}
        onChange={updateForm}
        onTest={() => {
          void testProvider();
        }}
        onUndoClearKey={() => {
          setForm((prev) => ({ ...prev, clearApiKey: false }));
        }}
        probeMsg={probeMsg}
        probing={probing}
        provider={provider}
        saveState={saveState}
      />

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
          {models.map((model) => (
            <ProviderModelRow
              d={d}
              key={model.id}
              model={model}
              onAction={runModelAction}
              p={p}
              provider={provider}
              usage={usage}
            />
          ))}
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
