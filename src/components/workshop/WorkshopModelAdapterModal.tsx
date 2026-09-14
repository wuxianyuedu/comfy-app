"use client";

// ── 工坊「模型适配」弹窗（规范 §17.2 第③层：只渲染 + 上抛）────────────────
// 替代旧的「API 通道设置」：不再配一个全局端点，而是给每条远端模型配置
// 「工坊每种模式下的输入/输出适配器」——模式即工作流库定义的模式
// （文生图 T2I 的输入 = 提示词 + 宽高比 + 百万像素 + 倍数，输出 = 图片；图生图 =
// 图片 + 提示词…）。统一输入类型清单见 lib/workshop/model-mode-contract.ts，
// 每行把一种统一输入映射到该接口请求体里的字段名；产物按 outputField 提取。
// 契约层的「尺寸」是一个口，到适配器层才拆成这三行（与尺寸选择器的两类表达对齐）。

import React from "react";

import {
  MODE_CONTRACT_INPUT_TYPES,
  WORKSHOP_INPUT_TYPES,
  builtInModeContract,
  modeContractInputIdLabel,
  modeContractInputLabel,
  workshopInputLabel,
  type ModeContract,
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

/** 中文展示名 + 机器 id：界面上只写中文时，对不上代码 / 日志 / 配置里的 id
 *  （并且契约口与适配器口是两套 id，光看中文「尺寸」分不清 size 还是 aspect-ratio）。 */
function LabelWithId({ label, id }: { label: string; id: string }) {
  return (
    <>
      {label}
      <span className="text-muted-foreground/60 ml-1 font-mono text-[10px]">{id}</span>
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
    modeContracts,
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
  /** 顶层页签：模型适配（每模型每模式字段映射）/ 模式契约（全局统一输入输出） */
  const [tab, setTab] = React.useState<"adapters" | "contract">("adapters");
  /* 契约编辑：当前编辑的模式 + 该模式的契约草稿（null = 未进入编辑） */
  const [contractMode, setContractMode] = React.useState<string | null>(null);
  const [contractDraft, setContractDraft] = React.useState<ModeContract | null>(null);

  const updateAdapter = (
    mode: string,
    updater: (a: (typeof draft)[number]) => (typeof draft)[number],
  ) => {
    setDraft((prev) => prev.map((a) => (a.mode === mode ? updater(a) : a)));
  };

  /** 进入某模式的契约编辑：注册表里改过用改过的，没改过用内置默认。 */
  const editContract = (mode: string) => {
    setContractMode(mode);
    setContractDraft(
      modeContracts.contracts.find((c) => c.mode === mode) ??
        builtInModeContract(mode),
    );
  };

  /** 保存契约注册表（当前编辑模式的草稿并入整份注册表）。 */
  const saveContract = () => {
    if (!contractDraft) return;
    const rest = modeContracts.contracts.filter(
      (c) => c.mode !== contractDraft.mode,
    );
    void modeContracts.save([...rest, contractDraft]);
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
              百万像素、倍数、图片…）映射到该接口请求体的字段名，产物按字段路径提取。
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

        <div className="border-border flex items-center gap-1.5 px-5 pb-2">
          {(
            [
              { key: "adapters", label: "模型适配" },
              { key: "contract", label: "模式契约" },
            ] as const
          ).map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => setTab(item.key)}
              className={`rounded-full px-3 py-1 text-xs transition-colors ${
                tab === item.key
                  ? "bg-primary/10 text-primary border border-(--color-primary)/30"
                  : "border-border text-muted-foreground border hover:bg-(--color-subtle)"
              }`}
            >
              {item.label}
            </button>
          ))}
          {tab === "contract" && (
            <span className="text-muted-foreground ml-1 text-[10px]">
              每种模式的统一输入 / 输出 —— 本地工作流按它配落点，远端模型按它建适配器
            </span>
          )}
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto px-5 pb-4">
          {tab === "adapters" && (
          <>
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
                                <LabelWithId label={t.label} id={t.code} />
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
                      {getWorkflowType(a.mode)?.category === "video"
                        ? "视频（video）"
                        : "图片（image）"}
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
                              {workshopInputLabel(t.type)}（{t.type}）
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

          </>
          )}

          {tab === "contract" && (
            <div className="space-y-3">
              <div>
                <p className="text-ink/80 mb-1.5 text-xs font-medium">
                  选择要配置的模式（与工作流库同一定义）
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {availableModes.map((t) => (
                    <button
                      key={t.code}
                      type="button"
                      onClick={() => editContract(t.code)}
                      className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                        contractMode === t.code
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border text-muted-foreground hover:bg-(--color-subtle)"
                      }`}
                    >
                      <LabelWithId label={t.label} id={t.code} />
                      {modeContracts.contracts.some((c) => c.mode === t.code) && (
                        <span className="text-primary/70 ml-1 text-[10px]">已改</span>
                      )}
                    </button>
                  ))}
                </div>
                <p className="text-muted-foreground/70 mt-1 text-[10px]">
                  标「已改」的模式使用你自定义的统一输入 / 输出；其余按内置默认。
                </p>
              </div>

              {contractDraft && (
                <div className="border-primary-soft bg-primary-soft/20 space-y-2 rounded-xl border p-3">
                  <p className="text-ink text-xs font-semibold">
                    {modeLabel(contractDraft.mode)}（<span className="text-muted-foreground/60 font-mono text-[10px]">{contractDraft.mode}</span>）的统一对外参数
                  </p>
                  <p className="text-muted-foreground text-[10px]">
                    输入口（按顺序作为工坊对该模式的统一输入；本地工作流在「画布节点」
                    为每个口配落点，远端模型在「模型适配」里为每个口配请求字段）
                  </p>
                  <div className="space-y-1.5">
                    {contractDraft.inputs.map((input, i) => (
                      <div
                        key={`${input}-${i}`}
                        className="border-border bg-surface flex items-center justify-between rounded-lg border px-2.5 py-1.5"
                      >
                        <span className="text-ink text-[11px]">
                          {i + 1}.{" "}
                          <LabelWithId
                            label={modeContractInputIdLabel(input)}
                            id={input}
                          />
                        </span>
                        <button
                          type="button"
                          disabled={input === "prompt"}
                          onClick={() =>
                            setContractDraft({
                              ...contractDraft,
                              inputs: contractDraft.inputs.filter((_, j) => j !== i),
                            })
                          }
                          className="text-muted-foreground/60 hover:text-red-500 px-1 text-xs disabled:opacity-30"
                          aria-label={`移除 ${modeContractInputIdLabel(input)}`}
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {MODE_CONTRACT_INPUT_TYPES.filter(
                      (t) => !contractDraft.inputs.includes(t.type),
                    ).map((t) => (
                      <button
                        key={t.type}
                        type="button"
                        onClick={() =>
                          setContractDraft({
                            ...contractDraft,
                            inputs: [...contractDraft.inputs, t.type],
                          })
                        }
                        className="border-primary text-primary hover:bg-primary/10 rounded border border-dashed border-(--color-primary)/40 px-2 py-0.5 text-[11px]"
                      >
                        ＋ <LabelWithId label={modeContractInputLabel(t.type)} id={t.type} />
                      </button>
                    ))}
                  </div>
                  <div>
                    <p className="text-muted-foreground mb-1 text-[10px]">输出类别</p>
                    <select
                      value={contractDraft.output}
                      onChange={(event) =>
                        setContractDraft({
                          ...contractDraft,
                          output: event.target.value as ModeContract["output"],
                        })
                      }
                      className="border-border bg-bg text-ink rounded-lg border px-2 py-1 text-[11px]"
                    >
                      <option value="image">图片（image）</option>
                      <option value="video">视频（video）</option>
                      <option value="audio">音频（audio）</option>
                    </select>
                  </div>
                  {!contractDraft.inputs.includes("prompt") && (
                    <p className="rounded-lg bg-amber-100 px-2 py-1 text-[11px] text-amber-700">
                      契约里没有「提示词」口 —— 工坊生成的提示词将无处可落，
                      保存后该模式无法被工坊驱动。
                    </p>
                  )}
                  <button
                    type="button"
                    onClick={saveContract}
                    disabled={modeContracts.saving}
                    className="bg-primary rounded-lg px-3 py-1.5 text-xs font-medium text-white transition-opacity disabled:opacity-40"
                  >
                    {modeContracts.saving ? "保存中…" : "保存模式契约"}
                  </button>
                </div>
              )}
            </div>
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
