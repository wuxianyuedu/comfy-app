"use client";

/**
 * 「添加 / 编辑模型」弹窗（规范 17 §17.2 第③层）。
 *
 * 接口地址 / API Key 可留空回落全局；编辑态密钥「留空不改」，可显式清除。
 * 「测试连接」成功后顺带展示服务端模型清单供点选。交互状态与动作由
 * `useRemoteModelDialogs`（第②层）承载，视图只渲染与触发。
 *
 * 字段级校验走 `~/lib/llm/remote-model-schema`（纯函数），controller 转述成
 * `fieldErrors`；视图只把文案挂在对应字段下方（口径见规范 16 §16.2.4.8）。
 */

import { SelectMenu } from "~/components/ui/select-menu";
import { textHandler } from "~/lib/form-props";
import { FormField } from "~/components/ui/form-field";
import { Dialog, DialogContent } from "~/components/ui/dialog";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import {
  REMOTE_MODEL_KINDS,
  REMOTE_MODEL_KIND_LABELS,
  type RemoteModelKind,
} from "~/lib/llm/types";

import type { ReadySettingsPageController } from "../hooks/use-settings-page";
import type { ModelDialog, RemoteModelDialogs } from "../hooks/use-remote-model-dialogs";

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
  /* 关闭语义（Esc / 点遮罩）交给 `ui/dialog`：此前自绘遮罩 div + 手写
     `onClick`，Esc 与焦点归还都没有。 */
  return (
    <Dialog
      onOpenChange={(next) => {
        if (!next) {
          d.closeDialog();
        }
      }}
      open
    >
      {/* 本弹窗自绘关闭按钮（见下方 header）——必须关掉基元的内置那枚，
          否则会渲染出两枚重叠的 ✕（见 `ui/dialog` 的 `showCloseButton`）。 */}
      <DialogContent
        aria-label={dialog.mode === "edit" ? "编辑模型" : "添加模型"}
        className="bg-transparent p-0 ring-0"
        popupClassName="max-w-md"
        showCloseButton={false}
      >
        <div className="border-border bg-surface w-full max-w-md rounded-2xl border p-5 shadow-2xl">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="u-title">{dialog.mode === "edit" ? "编辑模型" : "添加模型"}</h3>
            <Button
              aria-label="关闭"
              className="text-muted-foreground hover:text-ink"
              onClick={() => {
                d.closeDialog();
              }}
              size="icon-sm"
              variant="ghost"
            >
              ✕
            </Button>
          </div>

          <FormField
            className="mb-3"
            id="remote-model-provider"
            label="供应商（仅支持 OpenAI 兼容协议 API）"
          >
            {(field) => (
              <SelectMenu
                {...field}
                autoFitFromOptions={false}
                className="text-sm"
                disabled
                fullWidth
                labels={{ custom: "◇ 自定义" }}
                onChange={() => undefined}
                options={["custom"]}
                popoverMinWidth={160}
                value="custom"
              />
            )}
          </FormField>

          <FormField className="mb-3" id="remote-model-kind" label="用途">
            {(field) => (
              <SelectMenu
                {...field}
                autoFitFromOptions={false}
                className="text-sm"
                fullWidth
                labels={REMOTE_MODEL_KIND_LABELS}
                onChange={(kind) => {
                  d.setAddForm((f) => ({
                    ...f,
                    /* SAFETY: 类型断言已复核 */
                    kind: kind as RemoteModelKind,
                  }));
                }}
                options={[...REMOTE_MODEL_KINDS]}
                popoverMinWidth={160}
                value={d.addForm.kind}
              />
            )}
          </FormField>

          <FormField
            className="mb-3"
            hint="留空则跟随已保存的全局接口地址"
            id="remote-model-base-url"
            label="接口地址"
          >
            {(a11y) => (
              <Input
                {...a11y}
                className="border-border bg-surface-2 text-ink placeholder:text-muted-foreground/60 focus-visible:border-primary focus-visible:ring-primary/30 h-auto rounded-lg px-3 py-2 text-sm"
                onChange={textHandler((baseUrl) => {
                  d.setAddForm({ ...d.addForm, baseUrl });
                })}
                placeholder="https://api.example.com/v1"
                type="text"
                value={d.addForm.baseUrl}
              />
            )}
          </FormField>

          <FormField id="remote-model-api-key" label="API Key">
            {(a11y) => (
              <div className="mb-1 flex gap-2">
                <Input
                  {...a11y}
                  className="border-border bg-surface-2 text-ink placeholder:text-muted-foreground/60 focus-visible:border-primary focus-visible:ring-primary/30 h-auto rounded-lg px-3 py-2 text-sm"
                  onChange={(event) => {
                    d.setAddForm({
                      ...d.addForm,
                      apiKey: event.target.value,
                    });
                    /* 输入新密钥即撤销「清除」标记 */
                    if (event.target.value) {
                      d.setClearKey(false);
                    }
                  }}
                  placeholder={
                    dialog.mode === "edit" && dialog.entry.apiKey
                      ? "已设置独立密钥，留空保持不变"
                      : "留空则使用全局 API Key"
                  }
                  type="password"
                  value={d.addForm.apiKey}
                />
                <Button
                  className="text-muted-foreground h-auto shrink-0 rounded-lg px-3 py-2 text-sm"
                  disabled={d.testing}
                  // oxlint-disable-next-line no-void -- reject 由 action 内部捕获
                  onClick={() => void d.testConnection()}
                  variant="outline"
                >
                  {d.testing ? "测试中…" : "测试连接"}
                </Button>
              </div>
            )}
          </FormField>
          {dialog.mode === "edit" && dialog.entry.apiKey && (
            <p className="text-muted-foreground text-2xs mb-1">
              {d.clearKey ? (
                <>
                  将清除独立密钥、改用全局 API Key。
                  <Button
                    className="text-primary mx-1 h-auto p-0 underline underline-offset-2"
                    onClick={() => {
                      d.setClearKey(false);
                    }}
                    variant="link"
                  >
                    撤销
                  </Button>
                </>
              ) : (
                !d.addForm.apiKey && (
                  <Button
                    className="text-primary h-auto p-0 underline underline-offset-2"
                    onClick={() => {
                      d.setClearKey(true);
                    }}
                    variant="link"
                  >
                    清除独立密钥，改用全局
                  </Button>
                )
              )}
            </p>
          )}
          {d.testMsg && (
            <p
              className={`mb-3 rounded-lg px-3 py-2 text-xs ${
                d.testMsg.kind === "ok"
                  ? "bg-success/10 text-success-strong"
                  : "bg-destructive/10 text-danger-strong"
              }`}
            >
              {d.testMsg.text}
            </p>
          )}
          {d.suggestions.length > 0 && (
            <div className="mb-3">
              <p className="text-muted-foreground text-2xs mb-1">
                从服务端拉到的模型（点击填入）：
              </p>
              <div className="border-border/50 max-h-28 overflow-y-auto rounded-lg border p-2">
                <div className="flex flex-wrap gap-1.5">
                  {d.suggestions.map((name) => (
                    <Button
                      className="text-muted-foreground hover:text-ink text-2xs h-auto rounded px-2 py-0.5"
                      key={name}
                      onClick={() => {
                        d.setAddForm((f) => ({ ...f, model: name }));
                      }}
                      size="xs"
                      variant="outline"
                    >
                      {name}
                    </Button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* 字段级错误行与 `aria-invalid` / `aria-describedby` 由
              `FormField` 一次给全（规范 16 §16.2.4.26）—— 收口前这里手写了
              `aria-invalid`，却**没有**把错误文案关联给控件，读屏器只知道
              「这个框是错的」、不知道错在哪。 */}
          <FormField
            className="mb-3"
            error={d.fieldErrors.model}
            id="remote-model-name"
            label="模型名称"
          >
            {(a11y) => (
              <Input
                {...a11y}
                className="border-border bg-surface-2 text-ink placeholder:text-muted-foreground/60 focus-visible:border-primary focus-visible:ring-primary/30 h-auto rounded-lg px-3 py-2 text-sm"
                onChange={(event) => {
                  d.setAddForm({ ...d.addForm, model: event.target.value });
                }}
                placeholder="输入模型参数值，例如 gpt-4o 或 openai/gpt-4o"
                type="text"
                value={d.addForm.model}
              />
            )}
          </FormField>
          {d.addError && (
            <p className="bg-destructive/10 text-danger-strong mt-2 rounded-lg px-3 py-2 text-xs">
              {d.addError}
            </p>
          )}

          <div className="mt-4 flex justify-end gap-2">
            <Button
              className="text-muted-foreground h-auto rounded-lg px-4 py-2 text-sm"
              onClick={() => {
                d.closeDialog();
              }}
              variant="outline"
            >
              取消
            </Button>
            <Button
              className="h-auto rounded-lg px-4 py-2 text-sm font-semibold"
              /* 不再因「名称为空」禁用：禁用态下点不动，字段级提示就永远出不来
                 （规范性提示要么可达、要么写在 onSubmit 之前）。校验交给
                 `submitDialog` 的字段级判定，失败逐字段标红。 */
              disabled={c.saving}
              // oxlint-disable-next-line no-void -- reject 由 action 内部捕获
              onClick={() => void d.submitDialog()}
            >
              {c.saving ? "保存中…" : dialog.mode === "edit" ? "保存" : "添加并保存"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
