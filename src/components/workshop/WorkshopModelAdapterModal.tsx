"use client";

// ── 工坊「模型适配」弹窗（规范 §17.2 第③层：只渲染 + 上抛）────────────────
// 替代旧的「API 通道设置」：不再配一个全局端点，而是给每条远端模型配置
// 「工坊每种模式下的输入/输出适配器」——模式即工作流库定义的模式
// （文生图 T2I 的输入 = 提示词 + 宽高比 + 百万像素 + 倍数，输出 = 图片；图生图 =
// 图片 + 提示词…）。统一输入类型清单见 lib/workshop/model-mode-contract.ts，
// 每行把一种统一输入映射到该接口请求体里的字段名；产物按 outputField 提取。
// 契约层的「尺寸」是一个口，到适配器层才拆成这三行（与尺寸选择器的两类表达对齐）。
//
// 这里只管**模型适配**（接口级：每个远端模型 × 每个模式）；「模式契约」
// （模式级：每种模式对外有哪些统一输入 / 输出）是并列的独立入口与独立界面，
// 见`mode-contract/ModeContractDialog.tsx` —— 两个入口读写同一份注册表。

import React from "react";

import {
  WORKSHOP_INPUT_TYPES,
  workshopInputLabel,
  type WorkshopInputType,
} from "~/lib/workshop/model-mode-contract";
import {
  ALL_WORKFLOW_TYPES,
  getWorkflowType,
} from "~/lib/workflow/workflow-types";
import { Button } from "~/components/ui/button";
import { FormField } from "~/components/ui/form-field";
import { Dialog, DialogContent } from "~/components/ui/dialog";
import { useModelAdapters } from "./hooks/use-model-adapters";

const MODE_GROUPS: Array<{
  category: "image" | "video" | "audio";
  label: string;
}> = [
  { category: "image", label: "图像" },
  { category: "video", label: "视频" },
  { category: "audio", label: "音频" },
];

function modeLabel(mode: string): string {
  return getWorkflowType(mode)?.label ?? mode;
}

/** 中文展示名 + 机器 id：界面上只写中文时，对不上代码 / 日志 / 配置里的 id
 * （并且契约口与适配器口是两套 id，光看中文「尺寸」分不清 size 还是 aspect-ratio）。 */
function LabelWithId({ label, id }: { label: string; id: string }) {
  return (
    <>
      {label}
      <span className="text-muted-foreground/60 ml-1 font-mono text-[10px]">
        {id}
      </span>
    </>
  );
}

export function WorkshopModelAdapterModal({
  onClose,
}: {
  onClose: () => void;
}) {
  const controller = useModelAdapters();
  const {
    candidates,
    loading,
    draft,
    setDraft,
    selectModel,
    selectedModel,
    addMode,
    save,
    saving,
    message,
  } = controller;

  const [addModeOpen, setAddModeOpen] = React.useState(false);

  const updateAdapter = (
    mode: string,
    updater: (a: (typeof draft)[number]) => (typeof draft)[number],
  ) => {
    setDraft((prev) => prev.map((a) => (a.mode === mode ? updater(a) : a)));
  };

  const availableModes = ALL_WORKFLOW_TYPES.filter((t) => t.isGenerative);

  /* 关闭语义（Esc / 点遮罩 / 焦点锁与归还）交给`ui/dialog`：此前自绘遮罩 +
 手写`onClick` 关闭，Esc 没接、焦点不锁也不归还。 */
  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent
        showCloseButton={false}
        className="bg-transparent p-0 ring-0"
        popupClassName="max-w-3xl"
      >
        <div className="border-border bg-surface flex max-h-[86vh] w-full max-w-3xl flex-col rounded-2xl border shadow-2xl">
          <div className="flex items-center justify-between px-5 pt-4 pb-2">
            <div>
              <h3 className="text-ink-strong text-sm font-semibold">
                模型适配
              </h3>
              <p className="text-muted-foreground mt-0.5 text-[11px]">
                为远端模型配置工坊各模式下的输入 /
                输出：统一输入（提示词、宽高比、
                百万像素、倍数、图片…）映射到该接口请求体的字段名，产物按字段路径提取。
              </p>
            </div>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={onClose}
              aria-label="关闭"
              className="text-muted-foreground hover:text-ink"
            >
              ✕
            </Button>
          </div>

          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto px-5 pb-4">
            {/* 模型选择 */}
            <div>
              <p className="text-ink/80 mb-1.5 text-xs font-medium">
                选择远端模型（生图 / 视频）
              </p>
              {loading ? (
                <p className="text-muted-foreground text-xs">加载中…</p>
              ) : candidates.length === 0 ? (
                <p className="bg-warning/10 text-warning-strong rounded-lg px-3 py-2 text-xs">
                  还没有远端模型 —— 到「设置 → 模型」添加 kind=图片 / 视频
                  的远端条目后， 回来为它配置各模式的输入输出。
                </p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {candidates.map((c) => (
                    <Button
                      key={c.name}
                      variant="outline"
                      size="xs"
                      onClick={() => selectModel(c.name)}
                      className={`h-auto rounded-full px-3 py-1 ${
                        selectedModel === c.name
                          ? "border-primary text-primary bg-primary/10"
                          : "text-muted-foreground hover:bg-subtle border-border hover:text-ink"
                      }`}
                    >
                      {c.name}
                      <span className="text-muted-foreground/70 ml-1 text-[10px]">
                        {c.kind === "image" ? "生图" : "视频"}
                      </span>
                    </Button>
                  ))}
                </div>
              )}
            </div>

            {selectedModel && (
              <>
                {/* 模式清单：已配置的口数 */}
                <div>
                  <p className="text-ink/80 mb-1.5 text-xs font-medium">
                    支持的工坊模式
                  </p>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {draft.map((a) => (
                      <span
                        key={a.mode}
                        className="border-border text-muted-foreground inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs"
                      >
                        <span>{modeLabel(a.mode)}</span>
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          aria-label={`移除模式 ${modeLabel(a.mode)}`}
                          onClick={() =>
                            setDraft((prev) =>
                              prev.filter((x) => x.mode !== a.mode),
                            )
                          }
                          className="text-muted-foreground/60 hover:text-danger-strong hover:bg-transparent"
                        >
                          ✕
                        </Button>
                      </span>
                    ))}
                    <Button
                      variant="outline"
                      size="xs"
                      onClick={() => setAddModeOpen((v) => !v)}
                      className="border-primary text-primary hover:bg-primary/10 h-auto rounded-full border-dashed px-2.5 py-1"
                    >
                      ＋ 添加模式
                    </Button>
                  </div>
                  {addModeOpen && (
                    <div className="border-border bg-bg mt-2 flex flex-col gap-2 rounded-lg border p-2">
                      {MODE_GROUPS.map((group) => {
                        const modes = availableModes.filter(
                          (t) => t.category === group.category,
                        );
                        if (modes.length === 0) return null;
                        return (
                          <div key={group.category}>
                            <p className="text-muted-foreground mb-1 text-[10px]">
                              {group.label}
                            </p>
                            <div className="flex flex-wrap gap-1">
                              {modes.map((t) => (
                                <Button
                                  key={t.code}
                                  variant="outline"
                                  size="xs"
                                  onClick={() => {
                                    addMode(t.code);
                                    setAddModeOpen(false);
                                  }}
                                  className="border-border text-muted-foreground hover:border-primary hover:text-primary h-auto rounded px-2 py-0.5 text-[11px]"
                                >
                                  <LabelWithId label={t.label} id={t.code} />
                                </Button>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* 每个已配置模式的适配器编辑 */}
                {draft.map((a) => (
                  <div
                    key={a.mode}
                    className="border-primary-soft bg-primary-soft/20 rounded-xl border p-3"
                  >
                    <div className="mb-2 flex items-center justify-between">
                      <p className="text-ink text-xs font-semibold">
                        {modeLabel(a.mode)}
                        <span className="text-muted-foreground/70 ml-1.5 font-mono text-[10px]">
                          {a.mode}
                        </span>
                      </p>
                      <span className="text-muted-foreground text-[10px]">
                        输出：
                        {getWorkflowType(a.mode)?.category === "video"
                          ? "视频（video）"
                          : "图片（image）"}
                      </span>
                    </div>
                    <FormField
                      label="端点路径（拼在模型 Base URL 后）"
                      id={`adapter-endpoint-${a.mode}`}
                      labelClassName="text-muted-foreground mb-1 text-[10px]"
                    >
                      {(a11y) => (
                        <input
                          {...a11y}
                          value={a.endpointPath}
                          onChange={(event) =>
                            updateAdapter(a.mode, (x) => ({
                              ...x,
                              endpointPath: event.target.value,
                            }))
                          }
                          className="border-border bg-bg focus:border-primary w-full rounded-lg border px-2.5 py-1.5 font-mono text-[11px] outline-none"
                        />
                      )}
                    </FormField>
                    <p className="text-muted-foreground mt-2 mb-1 block text-[10px]">
                      输入映射：统一输入类型 → 请求体字段名
                    </p>
                    <div className="flex-col gap-1.5">
                      {a.inputs.map((row, i) => (
                        <div
                          key={`${a.mode}-${row.type}-${i}`}
                          className="flex items-center gap-1.5"
                        >
                          <select
                            value={row.type}
                            onChange={(event) =>
                              updateAdapter(a.mode, (x) => ({
                                ...x,
                                inputs: x.inputs.map((r, j) =>
                                  j === i
                                    ? {
                                        type: event.target
                                          .value as WorkshopInputType,
                                        field: r.field,
                                      }
                                    : r,
                                ),
                              }))
                            }
                            className="border-border bg-bg text-ink w-44 rounded-lg border px-2 py-1 text-[11px]"
                          >
                            {WORKSHOP_INPUT_TYPES.map((t) => (
                              <option key={t.type} value={t.type}>
                                {workshopInputLabel(t.type)}（{t.type}）
                              </option>
                            ))}
                          </select>
                          <span className="text-muted-foreground text-[10px]">
                            →
                          </span>
                          <input
                            value={row.field}
                            onChange={(event) =>
                              updateAdapter(a.mode, (x) => ({
                                ...x,
                                inputs: x.inputs.map((r, j) =>
                                  j === i
                                    ? { ...r, field: event.target.value }
                                    : r,
                                ),
                              }))
                            }
                            placeholder="请求体字段名"
                            className="border-border bg-bg focus:border-primary flex-1 rounded-lg border px-2 py-1 font-mono text-[11px] outline-none"
                          />
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            aria-label="删除该输入映射"
                            onClick={() =>
                              updateAdapter(a.mode, (x) => ({
                                ...x,
                                inputs: x.inputs.filter((_, j) => j !== i),
                              }))
                            }
                            className="text-muted-foreground/60 hover:text-danger-strong hover:bg-transparent"
                          >
                            ✕
                          </Button>
                        </div>
                      ))}
                      <Button
                        variant="outline"
                        size="xs"
                        onClick={() =>
                          updateAdapter(a.mode, (x) => {
                            const used = new Set(x.inputs.map((r) => r.type));
                            const next =
                              WORKSHOP_INPUT_TYPES.find(
                                (t) => !used.has(t.type),
                              ) ?? WORKSHOP_INPUT_TYPES[0];
                            return {
                              ...x,
                              inputs: [
                                ...x.inputs,
                                { type: next.type, field: next.type },
                              ],
                            };
                          })
                        }
                        className="text-primary hover:bg-primary/10 border-primary/40 h-auto rounded border-dashed px-2 py-0.5 text-[11px]"
                      >
                        ＋ 添加输入映射
                      </Button>
                    </div>
                    <FormField
                      label="产物字段路径（响应 JSON 内，如 url / data.0.url；留空走通用提取）"
                      id={`adapter-output-${a.mode}`}
                      labelClassName="text-muted-foreground mt-2 mb-1 text-[10px]"
                    >
                      {(a11y) => (
                        <input
                          {...a11y}
                          value={a.outputField}
                          onChange={(event) =>
                            updateAdapter(a.mode, (x) => ({
                              ...x,
                              outputField: event.target.value,
                            }))
                          }
                          placeholder="url"
                          className="border-border bg-bg focus:border-primary w-full rounded-lg border px-2.5 py-1.5 font-mono text-[11px] outline-none"
                        />
                      )}
                    </FormField>
                  </div>
                ))}
              </>
            )}

            {message && (
              <p
                className={`rounded-lg px-3 py-2 text-xs ${
                  message.kind === "ok"
                    ? "bg-success/10 text-success-strong"
                    : "bg-destructive/10 text-destructive"
                }`}
              >
                {message.text}
              </p>
            )}
          </div>

          <div className="border-border flex items-center justify-end gap-2 border-t px-5 py-3">
            <Button
              variant="outline"
              size="sm"
              onClick={onClose}
              className="border-border text-muted-foreground hover:bg-subtle h-auto rounded-lg px-4 py-1.5 text-xs"
            >
              关闭
            </Button>
            <Button
              variant="primary-solid"
              size="sm"
              onClick={() => void save()}
              disabled={!selectedModel || saving}
              className="h-auto rounded-lg px-4 py-1.5 text-xs"
            >
              {saving ? "保存中…" : "保存适配器"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
