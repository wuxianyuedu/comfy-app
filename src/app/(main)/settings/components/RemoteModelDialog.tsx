"use client";

/**
 * 「添加 / 编辑模型」弹窗（规范 17 §17.2 第③层）。
 *
 * 接口地址 / API Key 可留空回落全局；编辑态密钥「留空不改」，可显式清除。
 * 「测试连接」成功后顺带展示服务端模型清单供点选。交互状态与动作由
 * `useRemoteModelDialogs`（第②层）承载，视图只渲染与触发。
 */

import { DarkSelect } from "@/components/studio/ui/DarkSelect";
import {
  REMOTE_MODEL_KINDS,
  REMOTE_MODEL_KIND_LABELS,
  type RemoteModelKind,
} from "~/lib/llm/types";
import { overlayClass } from "~/lib/full-screen-layer";

import type { ReadySettingsPageController } from "../hooks/use-settings-page";
import type {
  ModelDialog,
  RemoteModelDialogs,
} from "../hooks/use-remote-model-dialogs";

export function RemoteModelDialog({
  c,
  d,
  dialog,
}: {
  c: ReadySettingsPageController;
  d: RemoteModelDialogs;
  /** 非空由调用方保证：仅在弹窗打开时渲染。 */
  dialog: NonNullable<ModelDialog>;
}) {
  return (
    <>
      <div
        className={overlayClass(
          "modal",
          "bg-canvas-deep z-50 grid place-items-center p-4",
        )}
        onClick={() => d.closeDialog()}
      >
        <div
          className="border-border bg-surface w-full max-w-md rounded-2xl border p-5 shadow-2xl"
          onClick={(event) => event.stopPropagation()}
        >
          <div className="mb-4 flex items-center justify-between">
            <h3 className="u-title">
              {dialog.mode === "edit" ? "编辑模型" : "添加模型"}
            </h3>
            <button
              type="button"
              onClick={() => d.closeDialog()}
              className="text-muted-foreground hover:text-ink"
              aria-label="关闭"
            >
              ✕
            </button>
          </div>

          <label className="text-ink/80 mb-1.5 block text-sm font-medium">
            供应商（仅支持 OpenAI 兼容协议 API）
          </label>
          <DarkSelect
            className="mb-3 text-sm"
            value="custom"
            onChange={() => undefined}
            options={["custom"]}
            labels={{ custom: "◇ 自定义" }}
            disabled
            popoverMinWidth={160}
            autoFitFromOptions={false}
          />

          <label className="text-ink/80 mb-1.5 block text-sm font-medium">
            用途
          </label>
          <DarkSelect
            className="mb-3 text-sm"
            value={d.addForm.kind}
            onChange={(kind) =>
              d.setAddForm((f) => ({
                ...f,
                kind: kind as RemoteModelKind,
              }))
            }
            options={[...REMOTE_MODEL_KINDS]}
            labels={REMOTE_MODEL_KIND_LABELS}
            popoverMinWidth={160}
            autoFitFromOptions={false}
          />

          <label className="text-ink/80 mb-1.5 block text-sm font-medium">
            接口地址
          </label>
          <input
            type="text"
            value={d.addForm.baseUrl}
            onChange={(event) =>
              d.setAddForm({ ...d.addForm, baseUrl: event.target.value })
            }
            placeholder="https://api.example.com/v1"
            className="border-border text-ink placeholder:text-muted-foreground/60 focus:border-primary bg-surface-2 mb-1 w-full rounded-lg border px-3 py-2 text-sm outline-none"
          />
          <p className="text-muted-foreground mb-3 text-[11px]">
            留空则跟随已保存的全局接口地址
          </p>

          <label className="text-ink/80 mb-1.5 block text-sm font-medium">
            API Key
          </label>
          <div className="mb-1 flex gap-2">
            <input
              type="password"
              value={d.addForm.apiKey}
              onChange={(event) => {
                d.setAddForm({
                  ...d.addForm,
                  apiKey: event.target.value,
                });
                /* 输入新密钥即撤销「清除」标记 */
                if (event.target.value) d.setClearKey(false);
              }}
              placeholder={
                dialog.mode === "edit" && dialog.entry.apiKey
                  ? "已设置独立密钥，留空保持不变"
                  : "留空则使用全局 API Key"
              }
              className="border-border text-ink placeholder:text-muted-foreground/60 focus:border-primary bg-surface-2 w-full rounded-lg border px-3 py-2 text-sm outline-none"
            />
            <button
              type="button"
              onClick={() => void d.testConnection()}
              disabled={d.testing}
              className="border-border text-muted-foreground hover:bg-subtle shrink-0 rounded-lg border px-3 py-2 text-sm transition-colors disabled:opacity-40"
            >
              {d.testing ? "测试中…" : "测试连接"}
            </button>
          </div>
          {dialog.mode === "edit" && dialog.entry.apiKey && (
            <p className="text-muted-foreground mb-1 text-[11px]">
              {d.clearKey ? (
                <>
                  将清除独立密钥、改用全局 API Key。
                  <button
                    type="button"
                    onClick={() => d.setClearKey(false)}
                    className="text-primary mx-1 underline underline-offset-2"
                  >
                    撤销
                  </button>
                </>
              ) : (
                !d.addForm.apiKey && (
                  <button
                    type="button"
                    onClick={() => d.setClearKey(true)}
                    className="text-primary underline underline-offset-2"
                  >
                    清除独立密钥，改用全局
                  </button>
                )
              )}
            </p>
          )}
          {d.testMsg && (
            <p
              className={`mb-3 rounded-lg px-3 py-2 text-xs ${
                d.testMsg.kind === "ok"
                  ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300"
                  : "bg-red-100 text-red-700 dark:bg-red-500/10 dark:text-red-300"
              }`}
            >
              {d.testMsg.text}
            </p>
          )}
          {d.suggestions.length > 0 && (
            <div className="mb-3">
              <p className="text-muted-foreground mb-1 text-[11px]">
                从服务端拉到的模型（点击填入）：
              </p>
              <div className="border-border/50 max-h-28 overflow-y-auto rounded-lg border p-2">
                <div className="flex flex-wrap gap-1.5">
                  {d.suggestions.map((name) => (
                    <button
                      key={name}
                      type="button"
                      onClick={() =>
                        d.setAddForm((f) => ({ ...f, model: name }))
                      }
                      className="border-border text-muted-foreground hover:bg-subtle hover:text-ink rounded border px-2 py-0.5 text-[11px] transition-colors"
                    >
                      {name}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          <label className="text-ink/80 mb-1.5 block text-sm font-medium">
            模型名称
          </label>
          <input
            type="text"
            value={d.addForm.model}
            onChange={(event) =>
              d.setAddForm({ ...d.addForm, model: event.target.value })
            }
            placeholder="输入模型参数值，例如 gpt-4o 或 openai/gpt-4o"
            className="border-border text-ink placeholder:text-muted-foreground/60 focus:border-primary bg-surface-2 w-full rounded-lg border px-3 py-2 text-sm outline-none"
          />
          {d.addError && (
            <p className="mt-2 rounded-lg bg-red-100 px-3 py-2 text-xs text-red-700 dark:bg-red-500/10 dark:text-red-300">
              {d.addError}
            </p>
          )}

          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => d.closeDialog()}
              className="border-border text-muted-foreground hover:bg-subtle rounded-lg border px-4 py-2 text-sm transition-colors"
            >
              取消
            </button>
            <button
              type="button"
              onClick={() => void d.submitDialog()}
              disabled={c.saving || !d.addForm.model.trim()}
              className="bg-primary hover:bg-primary-hover rounded-lg px-4 py-2 text-sm font-semibold text-white transition-colors disabled:opacity-50"
            >
              {c.saving
                ? "保存中…"
                : dialog.mode === "edit"
                  ? "保存"
                  : "添加并保存"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
