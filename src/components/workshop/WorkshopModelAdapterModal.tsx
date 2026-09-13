"use client";

// ── 工坊「模型适配」弹窗（规范 §17.2 第③层：只渲染 + 上抛）────────────────
// 替代旧的「API 通道设置」：不再配一个全局端点，而是给每条远端模型配置
// 「工坊每种模式下的输入/输出适配器」——模式即工作流库定义的模式
// （文生图 T2I 的输入 = 提示词 + 宽高比 + 百万像素，输出 = 图片；图生图 =
// 图片 + 提示词…）。统一输入类型清单见 lib/workshop/model-mode-contract.ts，
// 每行把一种统一输入映射到该接口请求体里的字段名；产物按 outputField 提取。

import React from "react";

import {
  WORKSHOP_INPUT_TYPES,
  workshopInputLabel,
  type WorkshopInputType,
} from "@/lib/workshop/model-mode-contract";
import {
  ALL_WORKFLOW_TYPES,
  getWorkflowType,
} from "~/lib/workflow-types";
import { overlayClass } from "~/lib/full-screen-layer";
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

  return (
    <div
      className={overlayClass("modal", "z-50 grid place-items-center bg-black/50 p-4")}
      onClick={onClose}
    >
      <div
        className="border-border bg-surface flex max-h-[86vh] w-full max-w-3xl flex-col rounded-2xl border shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 pt-4 pb-2">
          <div>
            <h3 className="text-ink-strong text-sm font-semibold">模型适配</h3>
            <p className="text-muted-foreground mt-0.5 text-[11px]">
              为远端模型配置工坊各模式下的输入 / 输出：统一输入（提示词、宽高比、
              百万像素、图片…）映射到该接口请求体的字段名，产物按字段路径提取。
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            className="text-muted-foreground hover:text-ink"
          >
            ✕
          </button>
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
              <p className="rounded-lg bg-amber-100 px-3 py-2 text-xs text-amber-700">
                还没有远端模型 —— 到「设置 → 模型」添加 kind=图片 / 视频 的远端条目后，
                回来为它配置各模式的输入输出。
              </p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {candidates.map((c) => (
                  <button
                    key={c.name}
                    type="button"
                    onClick={() => selectModel(c.name)}
                    className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                      selectedModel === c.name
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border text-muted-foreground hover:bg-(--color-subtle)"
                    }`}
                  >
                    {c.name}
                    <span className="text-muted-foreground/70 ml-1 text-[10px]">
                      {c.kind === "image" ? "生图" : "视频"}
                    </span>
                  </button>
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
                      <button
                        type="button"
                        aria-label={`移除模式 ${modeLabel(a.mode)}`}
                        onClick={() =>
                          setDraft((prev) => prev.filter((x) => x.mode !== a.mode))
                        }
                        className="text-muted-foreground/60 hover:text-red-500"
                      >
                        ✕
                      </button>
                    </span>
                  ))}
                  <button
                    type="button"
                    onClick={() => setAddModeOpen((v) => !v)}
                    className="border-primary text-primary hover:bg-primary/10 rounded-full border border-dashed px-2.5 py-1 text-xs"
                  >
                    ＋ 添加模式
                  </button>
                </div>
                {addModeOpen && (
                  <div className="border-border bg-bg mt-2 space-y-2 rounded-lg border p-2">
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
                              <button
                                key={t.code}
                                type="button"
                                onClick={() => {
                                  addMode(t.code);
                                  setAddModeOpen(false);
                                }}
                                className="border-border text-muted-foreground hover:border-primary hover:text-primary rounded border px-2 py-0.5 text-[11px]"
                              >
                                {t.label}
                              </button>
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
                      {getWorkflowType(a.mode)?.category === "video" ? "视频" : "图片"}
                    </span>
                  </div>
                  <label className="text-muted-foreground mb-1 block text-[10px]">
                    端点路径（拼在模型 Base URL 后）
                  </label>
                  <input
                    value={a.endpointPath}
                    onChange={(event) =>
                      updateAdapter(a.mode, (x) => ({
                        ...x,
                        endpointPath: event.target.value,
                      }))
                    }
                    className="border-border bg-bg focus:border-primary w-full rounded-lg border px-2.5 py-1.5 font-mono text-[11px] outline-none"
                  />
                  <p className="text-muted-foreground mt-2 mb-1 block text-[10px]">
                    输入映射：统一输入类型 → 请求体字段名
                  </p>
                  <div className="space-y-1.5">
                    {a.inputs.map((row, i) => (
                      <div key={`${a.mode}-${row.type}-${i}`} className="flex items-center gap-1.5">
                        <select
                          value={row.type}
                          onChange={(event) =>
                            updateAdapter(a.mode, (x) => ({
                              ...x,
                              inputs: x.inputs.map((r, j) =>
                                j === i
                                  ? {
                                      type: event.target.value as WorkshopInputType,
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
                              {workshopInputLabel(t.type)}
                            </option>
                          ))}
                        </select>
                        <span className="text-muted-foreground text-[10px]">→</span>
                        <input
                          value={row.field}
                          onChange={(event) =>
                            updateAdapter(a.mode, (x) => ({
                              ...x,
                              inputs: x.inputs.map((r, j) =>
                                j === i ? { ...r, field: event.target.value } : r,
                              ),
                            }))
                          }
                          placeholder="请求体字段名"
                          className="border-border bg-bg focus:border-primary flex-1 rounded-lg border px-2 py-1 font-mono text-[11px] outline-none"
                        />
                        <button
                          type="button"
                          aria-label="删除该输入映射"
                          onClick={() =>
                            updateAdapter(a.mode, (x) => ({
                              ...x,
                              inputs: x.inputs.filter((_, j) => j !== i),
                            }))
                          }
                          className="text-muted-foreground/60 hover:text-red-500 px-1 text-xs"
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                    <button
                      type="button"
                      onClick={() =>
                        updateAdapter(a.mode, (x) => {
                          const used = new Set(x.inputs.map((r) => r.type));
                          const next =
                            WORKSHOP_INPUT_TYPES.find((t) => !used.has(t.type)) ??
                            WORKSHOP_INPUT_TYPES[0];
                          return {
                            ...x,
                            inputs: [...x.inputs, { type: next.type, field: next.type }],
                          };
                        })
                      }
                      className="text-primary hover:bg-primary/10 rounded border border-dashed border-(--color-primary)/40 px-2 py-0.5 text-[11px]"
                    >
                      ＋ 添加输入映射
                    </button>
                  </div>
                  <label className="text-muted-foreground mt-2 mb-1 block text-[10px]">
                    产物字段路径（响应 JSON 内，如 url / data.0.url；留空走通用提取）
                  </label>
                  <input
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
                </div>
              ))}
            </>
          )}

          {message && (
            <p
              className={`rounded-lg px-3 py-2 text-xs ${
                message.kind === "ok"
                  ? "bg-emerald-100 text-emerald-700"
                  : "bg-red-100 text-red-700"
              }`}
            >
              {message.text}
            </p>
          )}
        </div>

        <div className="border-border flex items-center justify-end gap-2 border-t px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="border-border text-muted-foreground hover:bg-(--color-subtle) rounded-lg border px-4 py-1.5 text-xs"
          >
            关闭
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={!selectedModel || saving}
            className="bg-primary rounded-lg px-4 py-1.5 text-xs font-medium text-white transition-opacity disabled:opacity-40"
          >
            {saving ? "保存中…" : "保存适配器"}
          </button>
        </div>
      </div>
    </div>
  );
}
