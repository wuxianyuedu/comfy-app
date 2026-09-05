"use client";

/**
 * 设置页的纯展示视图（规范 17 §17.2 第③层）。
 *
 * 只消费 controller 的字段与动作，不发请求、不碰 tRPC。视图层自持的仅有
 * 交互状态：分区展开态、「添加模型」弹窗的表单草稿与进行态、任务温度输入的
 * 编辑期缓冲 —— 提交校验与网络都在逻辑层（hooks / lib client）。
 */

import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Loader2, Moon, Sun } from "lucide-react";
import { useRouter } from "next/navigation";

import { DarkSelect } from "@/components/studio/ui/DarkSelect";
import {
  REMOTE_MODEL_KINDS,
  REMOTE_MODEL_KIND_LABELS,
  type RemoteModelEntry,
  type RemoteModelKind,
  type TaskType,
} from "~/lib/llm/types";
import type {
  SettingsPageController,
  SettingsPageDrafts,
} from "./hooks/use-settings-page";
import {
  SETTINGS_SECTIONS,
  TEMPERATURE_TASKS,
} from "./hooks/use-settings-page";

/** 添加 / 编辑模型弹窗的表单草稿。 */
interface ModelDialogForm {
  baseUrl: string;
  apiKey: string;
  model: string;
  /** 用途：对话（默认）/ 图片 / 视频——图片 / 视频模型先落配置，供远程生成接入。 */
  kind: RemoteModelKind;
}

/** `drafts` 非空由容器保证（`if (!c.drafts)` 早退），这里用交集类型表达，
 *  视图内不必逐处判空。 */
export type ReadySettingsPageController = SettingsPageController & {
  drafts: SettingsPageDrafts;
};

export function SettingsPageView({ c }: { c: ReadySettingsPageController }) {
  const router = useRouter();
  /* 「按任务温度」的展开态是纯视觉偏好（无副作用、不入库），按 §17.2 留在视图层。
   * 本地 Ollama 下它是温度的主配置区，默认展开。 */
  const [showTaskTemps, setShowTaskTemps] = useState(true);
  /* 任务温度输入的编辑期缓冲：受控值 = 覆盖值 ?? 推荐默认，若直接改受控值，
   * 「清空重输」会被推荐值瞬间顶回。编辑期用这层缓冲兜住击键，blur 后丢弃、
   * 回落到「覆盖 ?? 推荐」的真实受控值。 */
  const [taskTempEdits, setTaskTempEdits] = useState<
    Partial<Record<TaskType, string>>
  >({});
  const setTaskEdit = (task: TaskType, raw: string) =>
    setTaskTempEdits((prev) => ({ ...prev, [task]: raw }));
  const clearTaskEdit = (task: TaskType) =>
    setTaskTempEdits((prev) => {
      const next = { ...prev };
      delete next[task];
      return next;
    });

  /* 「添加 / 编辑模型」弹窗：表单草稿、测试连接的进行态与结果、可点选的
   * 服务端模型清单。提交校验（重名拒绝等）在 controller，这里只管交互状态。
   * API Key 输入遵循「留空不改」：编辑时输入新值才覆盖，也可显式清除改用全局。 */
  const [dialog, setDialog] = useState<
    | { mode: "add" }
    | { mode: "edit"; original: string; entry: RemoteModelEntry }
    | null
  >(null);
  const [addForm, setAddForm] = useState<ModelDialogForm>({
    baseUrl: "",
    apiKey: "",
    model: "",
    kind: "chat",
  });
  const [testing, setTesting] = useState(false);
  const [testMsg, setTestMsg] = useState<{
    kind: "ok" | "err";
    text: string;
  } | null>(null);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [addError, setAddError] = useState<string | null>(null);
  const [clearKey, setClearKey] = useState(false);
  /* 列表行的就地测试（按条目自身的接口地址 / 密钥），同一时间只测一行 */
  const [rowTesting, setRowTesting] = useState<string | null>(null);
  const [rowTestMsg, setRowTestMsg] = useState<{
    name: string;
    kind: "ok" | "err";
    text: string;
  } | null>(null);

  /* ComfyUI 启动日志的滚动跟随是纯视觉偏好，留在视图层 */
  const comfyLogBoxRef = useRef<HTMLDivElement>(null);
  const [comfyLogFollow, setComfyLogFollow] = useState(true);
  useEffect(() => {
    const el = comfyLogBoxRef.current;
    if (el && comfyLogFollow) el.scrollTop = el.scrollHeight;
  }, [c.comfyLogText, comfyLogFollow]);
  const onComfyLogScroll = () => {
    const el = comfyLogBoxRef.current;
    if (!el) return;
    setComfyLogFollow(el.scrollHeight - el.scrollTop - el.clientHeight < 32);
  };

  function openAddDialog() {
    setDialog({ mode: "add" });
    setAddForm({ baseUrl: "", apiKey: "", model: "", kind: "chat" });
    setClearKey(false);
    setTestMsg(null);
    setSuggestions([]);
    setAddError(null);
  }

  function openEditDialog(entry: RemoteModelEntry) {
    setDialog({ mode: "edit", original: entry.name, entry });
    setAddForm({
      baseUrl: entry.baseUrl ?? "",
      apiKey: "",
      model: entry.name,
      kind: entry.kind ?? "chat",
    });
    setClearKey(false);
    setTestMsg(null);
    setSuggestions([]);
    setAddError(null);
  }

  async function handleTestConnection() {
    setTesting(true);
    setTestMsg(null);
    try {
      /* 编辑态 API Key 留空 = 沿用该条目已保存的密钥去测（「留空不改」） */
      const savedKey =
        dialog?.mode === "edit" ? dialog.entry.apiKey : undefined;
      const typedKey = addForm.apiKey.trim();
      const out = await c.probeRemote({
        baseUrl: addForm.baseUrl.trim() || undefined,
        apiKey: typedKey ? typedKey : (savedKey ?? undefined),
        model: addForm.model.trim() || undefined,
      });
      setTestMsg({ kind: out.ok ? "ok" : "err", text: out.detail });
      setSuggestions(out.ok && out.models ? out.models.slice(0, 40) : []);
    } finally {
      setTesting(false);
    }
  }

  async function handleRowTest(entry: RemoteModelEntry) {
    setRowTesting(entry.name);
    setRowTestMsg(null);
    try {
      const out = await c.probeRemote({
        baseUrl: entry.baseUrl ?? undefined,
        apiKey: entry.apiKey ?? undefined,
        model: entry.name,
      });
      setRowTestMsg({
        name: entry.name,
        kind: out.ok ? "ok" : "err",
        text: out.detail,
      });
    } finally {
      setRowTesting(null);
    }
  }

  function handleDialogSubmit() {
    setAddError(null);
    const baseUrl = addForm.baseUrl.trim();
    if (dialog?.mode === "edit") {
      const result = c.updateRemoteModel(dialog.original, {
        name: addForm.model,
        /* 空串 = 清掉独立接口（跟随全局） */
        baseUrl: baseUrl ? baseUrl : null,
        apiKey: addForm.apiKey.trim() ? addForm.apiKey.trim() : undefined,
        clearApiKey: clearKey && !addForm.apiKey.trim(),
        kind: addForm.kind,
      });
      if (!result.ok) {
        setAddError(result.error ?? "保存失败");
        return;
      }
      setDialog(null);
      return;
    }
    const result = c.addRemoteModel({
      name: addForm.model,
      /* 留空不落条目字段 → 跟随已保存的全局连接配置 */
      baseUrl: baseUrl || undefined,
      apiKey: addForm.apiKey.trim() ? addForm.apiKey.trim() : undefined,
      kind: addForm.kind,
    });
    if (!result.ok) {
      setAddError(result.error ?? "添加失败");
      return;
    }
    setDialog(null);
  }

  return (
    <div className="bg-bg h-[calc(100vh-var(--toolbar-height,48px))] overflow-y-auto pb-6">
      {/* Header bar */}
      <div className="border-border flex items-center gap-3 border-b px-6 py-4">
        <button
          onClick={() => router.back()}
          className="text-muted-foreground hover:bg-subtle hover:text-ink flex h-9 w-9 items-center justify-center rounded-lg transition-colors"
          title="返回"
        >
          <ArrowLeft size={18} />
        </button>
        <h1 className="text-ink text-lg font-semibold">设置</h1>
      </div>

      <div className="mx-auto flex max-w-[1100px] gap-6 px-6 py-6">
        {/* Left sidebar */}
        <nav className="w-48 shrink-0 space-y-1">
          {SETTINGS_SECTIONS.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => c.setSection(item.id)}
              className={`w-full rounded-lg px-3 py-2 text-center text-sm font-medium transition-colors ${
                c.section === item.id
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-subtle hover:text-ink"
              }`}
            >
              {item.label}
            </button>
          ))}
        </nav>

        {/* Content area */}
        <div className="min-w-0 flex-1">
          {c.flash && (
            <div
              className={`mb-4 rounded-lg border px-4 py-2 text-sm ${
                c.flash.kind === "ok"
                  ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                  : "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300"
              }`}
            >
              {c.flash.text}
            </div>
          )}

          {/* ═══ Appearance Section ═══ */}
          {c.section === "appearance" && (
            <Card title="外观主题">
              <p className="text-muted-foreground mb-4 text-sm">
                选择应用的主题外观：深色（Dark）或浅色（Light）。切换即时生效并自动保存，
                也可通过顶部导航栏的太阳/月亮按钮随时切换。
              </p>
              <div
                role="radiogroup"
                aria-label="主题外观"
                className="grid max-w-md grid-cols-2 gap-3"
              >
                {(
                  [
                    {
                      value: "dark",
                      label: "深色",
                      Icon: Moon,
                      hint: "适合低光环境",
                    },
                    {
                      value: "light",
                      label: "浅色",
                      Icon: Sun,
                      hint: "明亮、高对比",
                    },
                  ] as const
                ).map(({ value, label, Icon, hint }) => {
                  const active = c.theme === value;
                  return (
                    <button
                      key={value}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      onClick={() => c.setTheme(value)}
                      className={`flex flex-col items-start gap-1.5 rounded-xl border p-4 text-left transition-colors ${
                        active
                          ? "border-primary bg-primary-soft text-ink"
                          : "border-border bg-surface-1 text-muted-foreground hover:border-border-strong hover:text-ink"
                      }`}
                    >
                      <span className="flex items-center gap-2 text-sm font-semibold">
                        <Icon
                          size={18}
                          className={active ? "text-primary" : ""}
                        />
                        {label}
                      </span>
                      <span className="text-xs opacity-80">{hint}</span>
                    </button>
                  );
                })}
              </div>
            </Card>
          )}

          {/* ═══ LLM Section ═══ */}
          {c.section === "llm" && (
            <>
            <Card title="语言模型（LLM）">
              {/* 提供方页签：本地 / 远程分开配置；页签即切换（草稿态，保存落库），
                  「启用中」标记运行时实际使用的提供方 */}
              <div className="mb-4 flex items-center gap-2">
                {(["local", "remote"] as const).map((p) => {
                  const paneActive = c.drafts.llm.provider === p;
                  return (
                    <button
                      key={p}
                      type="button"
                      onClick={() => c.patchLlm({ provider: p })}
                      className={`rounded-lg border px-3.5 py-1.5 text-sm font-medium transition-colors ${
                        paneActive
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border text-muted-foreground hover:bg-subtle hover:text-ink"
                      }`}
                    >
                      {p === "local" ? "本地模型（Ollama）" : "远程模型（OpenAI 兼容）"}
                      {paneActive && (
                        <span className="ml-1.5 rounded-full bg-emerald-500/15 px-1.5 py-px text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
                          启用中
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>

              {/* Base URL 仅本地 Ollama 需要；远端的连接参数由模型条目各自携带 */}
              {c.drafts.llm.provider === "local" && (
                <Field
                  label="Base URL"
                  value={c.drafts.llm.baseUrl}
                  onChange={(value) => c.patchLlm({ baseUrl: value })}
                  placeholder="http://localhost:11434/v1"
                />
              )}

              {/* Ollama status row */}
              {c.drafts.llm.provider === "local" && (
                <div className="border-border bg-surface-1 mb-4 flex items-center gap-3 rounded-lg border px-3 py-2.5">
                  {c.ollamaStatus === "checking" && (
                    <>
                      <Loader2
                        size={14}
                        className="text-muted-foreground animate-spin"
                      />
                      <span className="text-muted-foreground text-sm">
                        检测 Ollama 服务…
                      </span>
                    </>
                  )}
                  {c.ollamaStatus === "starting" && (
                    <>
                      <Loader2
                        size={14}
                        className="text-muted-foreground animate-spin"
                      />
                      <span className="text-muted-foreground text-sm">
                        Ollama 启动中，正在等待服务就绪…
                      </span>
                    </>
                  )}
                  {c.ollamaStatus === "up" && (
                    <>
                      <span className="inline-block size-2 shrink-0 rounded-full bg-emerald-400" />
                      <span className="text-ink/80 text-sm">
                        Ollama 运行中（{c.ollamaModels.length} 个模型可用）
                      </span>
                      <Btn
                        onClick={() => void c.stopOllama()}
                        disabled={c.ollamaStopping}
                        className="ml-auto"
                      >
                        {c.ollamaStopping ? "关闭中…" : "关闭 Ollama"}
                      </Btn>
                    </>
                  )}
                  {c.ollamaStatus === "down" && (
                    <>
                      <span className="inline-block size-2 shrink-0 rounded-full bg-rose-400" />
                      <span className="text-ink/80 text-sm">Ollama 未运行</span>
                      <Btn
                        onClick={() => void c.startOllama()}
                        disabled={c.ollamaStarting}
                        className="ml-auto"
                      >
                        {c.ollamaStarting ? "启动中…" : "启动 Ollama"}
                      </Btn>
                    </>
                  )}
                </div>
              )}

              {/* Model area — local: Ollama 探测下拉；remote: 已配置模型列表 + 添加模型 */}
              {c.drafts.llm.provider === "local" &&
              c.ollamaStatus === "up" &&
              c.ollamaModels.length > 0 ? (
                <div className="mb-3">
                  <label className="text-ink/80 mb-1.5 block text-sm font-medium">
                    当前模型
                  </label>
                  <select
                    value={c.drafts.llm.model}
                    onChange={(event) =>
                      c.patchLlm({ model: event.target.value })
                    }
                    className="border-border text-ink focus:border-primary bg-surface-2 w-full rounded-lg border px-3 py-2 text-sm outline-none"
                  >
                    {c.ollamaModels.map((model) => (
                      <option key={model.name} value={model.name}>
                        {model.name}
                      </option>
                    ))}
                  </select>
                  {c.ollamaModels.length > 1 && (
                    <>
                      <label className="text-ink/80 mt-3 mb-1.5 block text-sm font-medium">
                        工坊候选模型（可多选）
                      </label>
                      <div className="flex flex-wrap gap-2">
                        {c.ollamaModels.map((model) => {
                          const checked =
                            model.name === c.drafts.llm.model ||
                            c.drafts.llm.extraModels.some(
                              (e) => e.name === model.name,
                            );
                          return (
                            <button
                              key={model.name}
                              type="button"
                              title={
                                model.name === c.drafts.llm.model
                                  ? "当前模型（始终可用）"
                                  : "勾选后工坊各阶段可直接切换"
                              }
                              onClick={() => c.toggleExtraModel(model.name)}
                              className={`rounded-lg border px-2.5 py-1 text-xs transition-colors ${
                                checked
                                  ? "border-primary bg-primary/15 text-primary"
                                  : "border-border text-muted-foreground hover:bg-white/5"
                              }`}
                            >
                              {checked ? "✓ " : ""}
                              {model.name}
                            </button>
                          );
                        })}
                      </div>
                    </>
                  )}
                </div>
              ) : c.drafts.llm.provider === "local" ? (
                <Field
                  label="模型"
                  value={c.drafts.llm.model}
                  onChange={(value) => c.patchLlm({ model: value })}
                  placeholder="llama3.1 或 qwen3:14b"
                />
              ) : (
                <>
                  {/* 已配置模型列表：主模型置顶；连接参数由条目各自携带，
                      添加 / 编辑走弹窗，保存时落库 */}
                  <div className="border-border bg-surface-1 mb-4 rounded-xl border p-4">
                    <div className="mb-3 flex items-center justify-between">
                      <span className="text-ink/80 text-sm font-medium">
                        已配置模型
                      </span>
                      <button
                        type="button"
                        onClick={openAddDialog}
                        className="bg-primary hover:bg-primary-hover rounded-lg px-3 py-1.5 text-xs font-semibold text-white transition-colors"
                      >
                        ＋ 添加模型
                      </button>
                    </div>
                    {c.remoteModelList.length > 0 ? (
                      <div className="space-y-1.5">
                        {c.remoteModelList.map((entry) => {
                          const isCurrent =
                            entry.name === c.drafts.llm.model;
                          return (
                            <div
                              key={entry.name}
                              className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors ${
                                isCurrent
                                  ? "border-primary bg-primary-soft"
                                  : "border-border"
                              }`}
                            >
                              <button
                                type="button"
                                onClick={() =>
                                  c.patchLlm({ model: entry.name })
                                }
                                title={
                                  isCurrent
                                    ? "当前生效模型"
                                    : "点击设为当前生效"
                                }
                                className="min-w-0 flex-1 truncate text-left"
                              >
                                <span
                                  className={
                                    isCurrent
                                      ? "text-primary font-medium"
                                      : "text-ink"
                                  }
                                >
                                  {entry.name}
                                </span>
                                {entry.baseUrl && (
                                  <span className="text-muted-foreground ml-2 text-[10px]">
                                    独立接口
                                  </span>
                                )}
                                {entry.apiKey && (
                                  <span className="text-muted-foreground ml-1.5 text-[10px]">
                                    独立密钥
                                  </span>
                                )}
                                {entry.kind && entry.kind !== "chat" && (
                                  <span className="text-muted-foreground ml-1.5 text-[10px]">
                                    {REMOTE_MODEL_KIND_LABELS[entry.kind]}模型
                                  </span>
                                )}
                              </button>
                              {isCurrent && (
                                <span className="text-primary shrink-0 text-[10px] font-medium">
                                  当前
                                </span>
                              )}
                              <button
                                type="button"
                                title="按该条目的接口地址与密钥测试连接"
                                onClick={() => void handleRowTest(entry)}
                                disabled={rowTesting !== null}
                                className="border-border text-muted-foreground hover:bg-subtle shrink-0 rounded border px-1.5 py-0.5 text-[11px] transition-colors disabled:opacity-40"
                              >
                                {rowTesting === entry.name
                                  ? "测试中…"
                                  : "测试"}
                              </button>
                              <button
                                type="button"
                                title="编辑接口地址 / 密钥 / 名称"
                                onClick={() => openEditDialog(entry)}
                                className="border-border text-muted-foreground hover:bg-subtle shrink-0 rounded border px-1.5 py-0.5 text-[11px] transition-colors"
                              >
                                编辑
                              </button>
                              {!isCurrent && (
                                <button
                                  type="button"
                                  title="移除该模型"
                                  onClick={() =>
                                    c.removeRemoteModel(entry.name)
                                  }
                                  className="text-muted-foreground hover:text-rose-500 shrink-0"
                                >
                                  ✕
                                </button>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="text-muted-foreground text-xs">
                        还没有模型 ——
                        点击「添加模型」把要用的模型加进来（填写接口地址与
                        API Key 后可先测试连接）。
                      </p>
                    )}
                    {rowTestMsg && (
                      <p
                        className={`mt-2 rounded-lg px-3 py-2 text-[11px] ${
                          rowTestMsg.kind === "ok"
                            ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300"
                            : "bg-red-100 text-red-700 dark:bg-red-500/10 dark:text-red-300"
                        }`}
                      >
                        「{rowTestMsg.name}」：{rowTestMsg.text}
                      </p>
                    )}
                    <p className="text-muted-foreground mt-2.5 text-[11px] leading-relaxed">
                      点击模型设为当前生效，工坊内也可随时切换；「测试」按该条目的接口地址与密钥探测连通性；带「独立接口／独立密钥」的模型调用时使用条目内配置，其余走已保存的全局连接配置。改动需点下方「保存
                      LLM 配置」生效。
                    </p>
                  </div>
                </>
              )}

              <div className="mb-4 grid grid-cols-2 gap-3">
                {c.drafts.llm.provider === "local" && (
                  <Field
                    label="全局默认温度"
                    value={String(c.drafts.llm.temperature)}
                    onChange={(value) =>
                      c.patchLlm({ temperature: Number(value) || 0 })
                    }
                  />
                )}
                <Field
                  label="最大 Token"
                  value={String(c.drafts.llm.maxTokens)}
                  onChange={(value) =>
                    c.patchLlm({ maxTokens: Number(value) || 0 })
                  }
                />
              </div>

              {/* 按任务类型配置温度 —— 仅本地 Ollama 展示；远端调用同样按这套
                  推荐默认取温度，但不在此暴露配置项 */}
              {c.drafts.llm.provider === "local" && (
                <div className="border-border bg-surface-1 mb-4 rounded-xl border p-4">
                  <button
                    type="button"
                    onClick={() => setShowTaskTemps((v) => !v)}
                    className="text-ink/80 hover:text-ink mb-3 flex w-full items-center justify-between text-sm font-medium"
                  >
                    <span>
                      按任务类型配置温度
                      <span className="text-muted-foreground ml-2 text-[11px] font-normal">
                        未覆盖的任务按推荐默认生效
                      </span>
                    </span>
                    <span className="text-muted-foreground">
                      {showTaskTemps ? "▾" : "▸"}
                    </span>
                  </button>
                  {showTaskTemps && (
                    <div className="space-y-3">
                      {TEMPERATURE_TASKS.map(([key, meta]) => {
                        const override =
                          c.drafts.llm.temperatureByTask?.[key];
                        const isOverridden =
                          override !== undefined && override !== null;
                        const shown =
                          taskTempEdits[key] ??
                          String(
                            isOverridden
                              ? override
                              : meta.defaultTemperature,
                          );
                        return (
                          <div
                            key={key}
                            className="border-border/50 bg-surface-1 flex items-center gap-3 rounded-lg border px-3 py-2.5"
                          >
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                <span className="text-ink text-sm font-medium">
                                  {meta.label}
                                </span>
                                {isOverridden ? (
                                  <span className="bg-primary/15 text-primary rounded-full px-1.5 py-0.5 text-[10px] font-medium">
                                    已覆盖
                                  </span>
                                ) : (
                                  <span className="rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
                                    推荐
                                  </span>
                                )}
                              </div>
                              <p className="text-muted-foreground text-[11px]">
                                {meta.desc}（推荐 {meta.hint}）
                              </p>
                            </div>
                            {isOverridden && (
                              <button
                                type="button"
                                title="恢复推荐默认"
                                onClick={() => {
                                  clearTaskEdit(key);
                                  c.setTaskTemperature(key, "");
                                }}
                                className="border-border text-muted-foreground hover:bg-subtle rounded border px-1.5 py-0.5 text-[11px]"
                              >
                                ↺
                              </button>
                            )}
                            <input
                              type="number"
                              step={0.05}
                              min={0}
                              max={2}
                              value={shown}
                              onChange={(event) => {
                                setTaskEdit(key, event.target.value);
                                c.setTaskTemperature(
                                  key,
                                  event.target.value,
                                );
                              }}
                              onBlur={() => clearTaskEdit(key)}
                              className="border-border text-ink focus:border-primary bg-surface-2 w-24 rounded-lg border px-2 py-1.5 text-right text-sm outline-none"
                            />
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              <Btn onClick={() => void c.saveLlm()} disabled={c.saving}>
                保存 LLM 配置
              </Btn>
            </Card>

            {/* 「添加 / 编辑模型」弹窗（远端提供方）：接口地址 / API Key 可留空
                回落全局；编辑态密钥「留空不改」，可显式清除。测试连接成功后
                顺带展示服务端模型清单供点选。 */}
            {c.drafts.llm.provider === "remote" && dialog && (
              <div
                className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4"
                onClick={() => setDialog(null)}
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
                      onClick={() => setDialog(null)}
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
                    value={addForm.kind}
                    onChange={(kind) =>
                      setAddForm((f) => ({ ...f, kind: kind as RemoteModelKind }))
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
                    value={addForm.baseUrl}
                    onChange={(event) =>
                      setAddForm({ ...addForm, baseUrl: event.target.value })
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
                      value={addForm.apiKey}
                      onChange={(event) => {
                        setAddForm({ ...addForm, apiKey: event.target.value });
                        /* 输入新密钥即撤销「清除」标记 */
                        if (event.target.value) setClearKey(false);
                      }}
                      placeholder={
                        dialog?.mode === "edit" && dialog.entry.apiKey
                          ? "已设置独立密钥，留空保持不变"
                          : "留空则使用全局 API Key"
                      }
                      className="border-border text-ink placeholder:text-muted-foreground/60 focus:border-primary bg-surface-2 w-full rounded-lg border px-3 py-2 text-sm outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => void handleTestConnection()}
                      disabled={testing}
                      className="border-border text-muted-foreground hover:bg-subtle shrink-0 rounded-lg border px-3 py-2 text-sm transition-colors disabled:opacity-40"
                    >
                      {testing ? "测试中…" : "测试连接"}
                    </button>
                  </div>
                  {dialog?.mode === "edit" && dialog.entry.apiKey && (
                    <p className="text-muted-foreground mb-1 text-[11px]">
                      {clearKey ? (
                        <>
                          将清除独立密钥、改用全局 API Key。
                          <button
                            type="button"
                            onClick={() => setClearKey(false)}
                            className="text-primary mx-1 underline underline-offset-2"
                          >
                            撤销
                          </button>
                        </>
                      ) : (
                        !addForm.apiKey && (
                          <button
                            type="button"
                            onClick={() => setClearKey(true)}
                            className="text-primary underline underline-offset-2"
                          >
                            清除独立密钥，改用全局
                          </button>
                        )
                      )}
                    </p>
                  )}
                  {testMsg && (
                    <p
                      className={`mb-3 rounded-lg px-3 py-2 text-xs ${
                        testMsg.kind === "ok"
                          ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300"
                          : "bg-red-100 text-red-700 dark:bg-red-500/10 dark:text-red-300"
                      }`}
                    >
                      {testMsg.text}
                    </p>
                  )}
                  {suggestions.length > 0 && (
                    <div className="mb-3">
                      <p className="text-muted-foreground mb-1 text-[11px]">
                        从服务端拉到的模型（点击填入）：
                      </p>
                      <div className="border-border/50 max-h-28 overflow-y-auto rounded-lg border p-2">
                        <div className="flex flex-wrap gap-1.5">
                          {suggestions.map((name) => (
                            <button
                              key={name}
                              type="button"
                              onClick={() =>
                                setAddForm((f) => ({ ...f, model: name }))
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
                    value={addForm.model}
                    onChange={(event) =>
                      setAddForm({ ...addForm, model: event.target.value })
                    }
                    placeholder="输入模型参数值，例如 gpt-4o 或 openai/gpt-4o"
                    className="border-border text-ink placeholder:text-muted-foreground/60 focus:border-primary bg-surface-2 w-full rounded-lg border px-3 py-2 text-sm outline-none"
                  />
                  {addError && (
                    <p className="mt-2 rounded-lg bg-red-100 px-3 py-2 text-xs text-red-700 dark:bg-red-500/10 dark:text-red-300">
                      {addError}
                    </p>
                  )}

                  <div className="mt-4 flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setDialog(null)}
                      className="border-border text-muted-foreground hover:bg-subtle rounded-lg border px-4 py-2 text-sm transition-colors"
                    >
                      取消
                    </button>
                    <button
                      type="button"
                      onClick={handleDialogSubmit}
                      disabled={!addForm.model.trim()}
                      className="bg-primary hover:bg-primary-hover rounded-lg px-4 py-2 text-sm font-semibold text-white transition-colors disabled:opacity-50"
                    >
                      {dialog.mode === "edit" ? "保存" : "添加"}
                    </button>
                  </div>
                </div>
              </div>
            )}
            </>
          )}

          {/* ═══ ComfyUI Section ═══ */}
          {c.section === "comfyui" && (
            <Card title="创作后端（ComfyUI）">
              <Field
                label="ComfyUI 路径（源码根或桌面版实例根）"
                value={c.drafts.settings.comfyuiPath}
                onChange={(value) => c.patchSettings({ comfyuiPath: value })}
                placeholder="例如 D:\\ComfyUI 或 D:\\Comfy-Desktop\\ComfyUI-Installs\\ComfyUI2"
              />
              <p className="text-muted-foreground -mt-2 mb-3 text-xs">
                桌面版（ComfyUI Desktop）请直接配置实例根目录（含
                ComfyUI/ 子目录与 standalone-env/），便携版配置含
                main.py 的源码根。自动识别 python_embeded / standalone-env /
                .venv 解释器，多个环境并存时优先选用装了依赖（torch）的那个。
                {c.comfyStatus?.pathConfigured
                  ? "已配置——ComfyUI 未运行时提交任务会自动拉起。"
                  : "未配置——ComfyUI 未运行时任务会失败。"}
              </p>
              <Field
                label="ComfyUI 端口"
                value={
                  c.drafts.settings.comfyuiPort > 0
                    ? String(c.drafts.settings.comfyuiPort)
                    : ""
                }
                onChange={(value) =>
                  c.patchSettings({
                    comfyuiPort: Math.max(0, Number(value) || 0),
                  })
                }
                placeholder="留空使用默认 8188"
              />
              <p className="text-muted-foreground -mt-2 mb-3 text-xs">
                非 8188 端口会在启动时自动传 --port，实际运行端口以设置为准。
              </p>
              <Field
                label="ComfyUI 启动参数（可选）"
                value={c.drafts.settings.comfyuiExtraArgs}
                onChange={(value) =>
                  c.patchSettings({ comfyuiExtraArgs: value })
                }
                placeholder="例如 --input-directory D:\\ComfyUI-Shared\\input"
              />
              <div className="mb-4 flex items-center gap-2">
                <input
                  id="comfyui-autostart"
                  type="checkbox"
                  className="size-4 accent-[var(--primary,#7c5cff)]"
                  checked={c.drafts.settings.comfyuiAutoStart}
                  onChange={(event) =>
                    c.patchSettings({ comfyuiAutoStart: event.target.checked })
                  }
                />
                <label
                  htmlFor="comfyui-autostart"
                  className="text-ink/80 text-sm"
                >
                  提交任务时 ComfyUI 未运行则自动启动
                </label>
              </div>
              <div className="border-border bg-surface-1 mb-4 flex items-center gap-3 rounded-lg border px-3 py-2">
                <span
                  className={`inline-block size-2 shrink-0 rounded-full ${
                    c.comfyStatus?.up
                      ? "bg-emerald-400"
                      : c.comfyStatus?.starting
                        ? "bg-amber-400"
                        : "bg-rose-400"
                  }`}
                />
                <span className="text-ink/80 text-sm">
                  {c.comfyStatus?.up
                    ? `ComfyUI 运行中${c.comfyStatus.base ? `（${c.comfyStatus.base}）` : ""}`
                    : c.comfyStarting || c.comfyStatus?.starting
                      ? "ComfyUI 正在启动…"
                      : "ComfyUI 未运行"}
                </span>
                <div className="ml-auto flex items-center gap-2">
                  <Btn
                    onClick={() => void c.startComfy()}
                    disabled={c.saving || c.comfyStarting || c.comfyStatus?.up}
                  >
                    {c.comfyStarting ? "启动中…" : "启动 ComfyUI"}
                  </Btn>
                  <Btn
                    onClick={() => void c.stopComfy()}
                    disabled={c.saving || c.comfyStopping || !c.comfyStatus?.up}
                  >
                    {c.comfyStopping ? "关闭中…" : "关闭 ComfyUI"}
                  </Btn>
                </div>
              </div>
              {/* ComfyUI 启动日志：启动期间每秒跟随 log/comfyui-runtime.log，
                  让「正在启动…」不再是个黑盒（硬规则 4 的用户可见出口） */}
              <div className="border-border bg-surface-1 mb-4 rounded-xl border">
                <div className="flex items-center justify-between px-3 py-2">
                  <span className="text-ink/80 flex items-center gap-2 text-sm font-medium">
                    启动日志（comfyui-runtime.log）
                    {c.comfyLogActive && (
                      <span className="inline-flex items-center gap-1.5 text-[10px] font-normal text-emerald-600 dark:text-emerald-400">
                        <span className="inline-block size-1.5 animate-pulse rounded-full bg-emerald-400" />
                        跟随中
                      </span>
                    )}
                  </span>
                  <div className="flex items-center gap-2">
                    {!comfyLogFollow && (
                      <button
                        type="button"
                        onClick={() => setComfyLogFollow(true)}
                        className="bg-primary/90 hover:bg-primary rounded px-2 py-0.5 text-[11px] font-medium text-white"
                      >
                        恢复自动滚动
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => void c.refreshComfyLog()}
                      className="border-border text-muted-foreground hover:bg-subtle rounded border px-2 py-0.5 text-[11px] transition-colors"
                    >
                      刷新
                    </button>
                  </div>
                </div>
                <div
                  ref={comfyLogBoxRef}
                  onScroll={onComfyLogScroll}
                  className="border-border/50 custom-scrollbar mx-3 mb-3 max-h-44 overflow-y-auto rounded-lg bg-black/30 px-3 py-2 font-mono text-[11px] leading-relaxed text-gray-300"
                >
                  {c.comfyLogText ? (
                    <span className="whitespace-pre-wrap break-all">
                      {c.comfyLogText}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">
                      暂无日志 ——
                      点「启动 ComfyUI」后这里会实时输出拉起过程（spawn
                      参数、模型加载与就绪状态）；也可点「刷新」查看最近一次运行日志。
                    </span>
                  )}
                </div>
              </div>
              <Field
                label="训练后端 URL"
                value={c.drafts.settings.trainerUrl}
                onChange={(value) => c.patchSettings({ trainerUrl: value })}
                placeholder="留空则显示「未配置」横幅"
              />
              <Field
                label="LoRA 输出目录"
                value={c.drafts.settings.comfyLorasDir}
                onChange={(value) => c.patchSettings({ comfyLorasDir: value })}
                placeholder="留空使用默认 models/loras"
              />
              <Btn onClick={() => void c.savePrefs()} disabled={c.saving}>
                保存偏好
              </Btn>
            </Card>
          )}

          {/* ═══ 数据库（Drizzle Studio）Section ═══ */}
          {c.section === "database" && (
            <Card title="数据库（Drizzle Studio）">
              <p className="text-muted-foreground mb-3 text-sm">
                可视化浏览本地 SQLite 数据库（schema / 表数据 / 运行 SQL）。
                Drizzle Studio 的界面托管在官方远端页面
                （local.drizzle.studio），本地只起一个回连端口；点「打开查看」
                会用你的系统默认浏览器打开它。
              </p>
              <div className="border-border bg-surface-1 flex items-center gap-3 rounded-lg border px-3 py-2">
                <span
                  className={`inline-block size-2 shrink-0 rounded-full ${
                    c.dbStudioStatus?.up
                      ? "bg-emerald-400"
                      : c.dbStudioStatus?.starting || c.dbStudioStarting
                        ? "bg-amber-400"
                        : "bg-rose-400"
                  }`}
                />
                <span className="text-ink/80 text-sm">
                  {c.dbStudioStatus?.up
                    ? `Drizzle Studio 运行中（端口 ${c.dbStudioStatus.port ?? 4983}）`
                    : c.dbStudioStarting || c.dbStudioStatus?.starting
                      ? "Drizzle Studio 正在启动…"
                      : "Drizzle Studio 未运行"}
                </span>
                <div className="ml-auto flex items-center gap-2">
                  <Btn
                    onClick={() => void c.openDbStudio()}
                    disabled={
                      c.saving || c.dbStudioOpening || !c.dbStudioStatus?.up
                    }
                  >
                    {c.dbStudioOpening ? "打开中…" : "打开查看"}
                  </Btn>
                  <Btn
                    onClick={() => void c.startDbStudio()}
                    disabled={
                      c.saving || c.dbStudioStarting || c.dbStudioStatus?.up
                    }
                  >
                    {c.dbStudioStarting ? "启动中…" : "启动 Drizzle Studio"}
                  </Btn>
                  <Btn
                    onClick={() => void c.stopDbStudio()}
                    disabled={
                      c.saving || c.dbStudioStopping || !c.dbStudioStatus?.up
                    }
                  >
                    {c.dbStudioStopping ? "关闭中…" : "关闭 Drizzle Studio"}
                  </Btn>
                </div>
              </div>
              <p className="text-muted-foreground mt-3 text-xs">
                说明：Drizzle Studio 需要本机开发依赖
                （node_modules 里的 drizzle-kit）。双击桌面壳的开发模式可用；
                若当前是不可携带完整 node_modules 的 standalone 打包，启动时会
                提示未找到 drizzle-kit。
              </p>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Shared UI ───────────────────────────────────────────── */

function Card({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="border-border bg-surface-1 rounded-2xl border p-5 backdrop-blur">
      <h2 className="text-ink mb-4 text-base font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
}) {
  return (
    <div className="mb-3">
      <label className="text-ink/80 mb-1.5 block text-sm font-medium">
        {label}
      </label>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className="border-border text-ink placeholder:text-muted-foreground/60 focus:border-primary bg-surface-2 w-full rounded-lg border px-3 py-2 text-sm outline-none"
      />
    </div>
  );
}

function Btn({
  onClick,
  disabled,
  children,
  className,
}: {
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`bg-primary hover:bg-primary-hover rounded-lg px-4 py-2 text-sm font-semibold text-white transition-colors disabled:opacity-50 ${className ?? ""}`}
    >
      {children}
    </button>
  );
}
