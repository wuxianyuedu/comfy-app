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
import type { AnsiSegment, AnsiStyleKey } from "~/lib/log-ansi";
import {
  REMOTE_MODEL_KINDS,
  REMOTE_MODEL_KIND_LABELS,
  type RemoteModelEntry,
  type RemoteModelKind,
  type TaskType,
} from "~/lib/llm/types";
import {
  MEDIA_URL_NOTICE,
  USAGE_FIELD_PRESETS,
  VIDEO_MODE_HINT,
  VIDEO_MODE_PRESETS,
  defaultVideoFields,
  hasUsageFieldKey,
  isMediaField,
  isModeValueBroken,
  usageFieldsToJson,
  looksLikeImage,
  videoModeHidesMedia,
  videoModeMissingHint,
  type UsageField,
} from "~/lib/llm/usage-test-config";
import type {
  UsageTestKind,
  UsageTestResult,
} from "~/lib/llm/usage-test-client";
import type {
  SettingsPageController,
  SettingsPageDrafts,
} from "./hooks/use-settings-page";
import {
  SETTINGS_SECTIONS,
  TEMPERATURE_TASKS,
} from "./hooks/use-settings-page";

/** 安装形态 → 设置页徽标文案。 */
const INSTANCE_KIND_LABEL: Record<
  "desktop" | "portable" | "venv" | "unknown",
  string
> = {
  desktop: "桌面版（ComfyUI Desktop）",
  portable: "便携版",
  venv: "venv",
  unknown: "未知安装",
};

/** 添加 / 编辑模型弹窗的表单草稿。 */
interface ModelDialogForm {
  baseUrl: string;
  apiKey: string;
  model: string;
  /** 用途：对话（默认）/ 图片 / 视频——图片 / 视频模型先落配置，供远程生成接入。 */
  kind: RemoteModelKind;
}

/** 「实际使用」测试弹窗的状态：参数可自定义，结果按用途渲染。 */
interface UsageTestDialogState {
  kind: UsageTestKind;
  entry: RemoteModelEntry;
  baseUrl: string;
  path: string;
  apiKey: string;
  prompt: string;
  size: string;
  /** 请求体额外字段（结构化编辑，替代原先手填整段 JSON）。 */
  fields: UsageField[];
  running: boolean;
  result: UsageTestResult | null;
}

/** 读取本地图片文件为 data URL，供图片字段上传（不回服务端，纯前端转码）。 */
function readImageAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      /* readAsDataURL 的结果必是字符串（data:image/...） */
      resolve(typeof reader.result === "string" ? reader.result : "");
    };
    reader.onerror = () => reject(new Error("读取图片失败"));
    reader.readAsDataURL(file);
  });
}

const USAGE_TEST_KIND_LABELS: Record<UsageTestKind, string> = {
  chat: "文本",
  image: "图片",
  video: "视频",
};

/** `drafts` 非空由容器保证（`if (!c.drafts)` 早退），这里用交集类型表达，
 *  视图内不必逐处判空。 */
export type ReadySettingsPageController = SettingsPageController & {
  drafts: SettingsPageDrafts;
};

export function SettingsPageView({
  c,
  onClose,
  className = "h-[calc(100vh-var(--toolbar-height,48px))]",
}: {
  c: ReadySettingsPageController;
  /** overlay 模式下由调用方传入关闭回调；独立路由下缺省用 router.back()。 */
  onClose?: () => void;
  /** 自定义根容器 class（overlay 模式传 h-full 等覆盖高度）。 */
  className?: string;
}) {
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

  /* ComfyUI 安装形态（由 comfyStatus 派生，供路径徽标 + 是否隐藏 端口/启动参数）。 */
  const comfyInstanceType = c.comfyStatus?.instanceType ?? null;
  const comfyDesktopManaged = !!c.comfyStatus?.desktopManaged;

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

  /* 每个模型条目的「实际使用」测试弹窗：按用途预填端点路径与提示词，
   * 路径 / 提示词 / 尺寸 / 额外参数（JSON）均可自定义输入。
   * 图片 / 视频会真实调用生成接口，消耗提供方额度 —— 弹窗内有预告。 */
  const [usageTest, setUsageTest] = useState<UsageTestDialogState | null>(null);

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

  /* Drizzle Studio 启动日志的滚动跟随（同 ComfyUI 的纯视觉偏好） */
  const dbStudioLogBoxRef = useRef<HTMLDivElement>(null);
  const [dbStudioLogFollow, setDbStudioLogFollow] = useState(true);
  useEffect(() => {
    const el = dbStudioLogBoxRef.current;
    if (el && dbStudioLogFollow) el.scrollTop = el.scrollHeight;
  }, [c.dbStudioLogText, dbStudioLogFollow]);
  const onDbStudioLogScroll = () => {
    const el = dbStudioLogBoxRef.current;
    if (!el) return;
    setDbStudioLogFollow(el.scrollHeight - el.scrollTop - el.clientHeight < 32);
  };

  /* Ollama 启动日志的滚动跟随（同 ComfyUI / Drizzle Studio 的纯视觉偏好） */
  const ollamaLogBoxRef = useRef<HTMLDivElement>(null);
  const [ollamaLogFollow, setOllamaLogFollow] = useState(true);
  useEffect(() => {
    const el = ollamaLogBoxRef.current;
    if (el && ollamaLogFollow) el.scrollTop = el.scrollHeight;
  }, [c.ollamaLogText, ollamaLogFollow]);
  const onOllamaLogScroll = () => {
    const el = ollamaLogBoxRef.current;
    if (!el) return;
    setOllamaLogFollow(el.scrollHeight - el.scrollTop - el.clientHeight < 32);
  };

  function openAddDialog(kind: RemoteModelKind = "chat") {
    setDialog({ mode: "add" });
    setAddForm({ baseUrl: "", apiKey: "", model: "", kind });
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

  /** 打开「实际使用」测试弹窗：按用途预填端点路径与提示词；
   *  base 已含资源子路径（如 …/v1/images）时路径只补动作段。 */
  function openUsageTest(kind: UsageTestKind, entry: RemoteModelEntry) {
    const base = entry.baseUrl ?? "";
    const defaults: Record<UsageTestKind, { path: string; prompt: string }> = {
      chat: {
        path: "/chat/completions",
        prompt: "用一句话介绍你自己",
      },
      image: {
        path: "/images/generations",
        prompt: "一只戴宇航员头盔的柴犬，写实风格，高清",
      },
      video: {
        path: "/videos/generations",
        prompt: "一只柴犬在草地上奔跑，阳光明媚，电影感",
      },
    };
    const preset = defaults[kind];
    const path =
      kind === "image" && /\/images$/i.test(base)
        ? "/generations"
        : kind === "video" && /\/videos$/i.test(base)
          ? ""
          : preset.path;
    setUsageTest({
      kind,
      entry,
      baseUrl: base,
      path,
      apiKey: "",
      prompt: preset.prompt,
      size: "",
      /* 视频接口普遍必填 mode（如 Agnes：text / keyframe / reference）。
       * 这里直接给一行可见、可改的 mode 字段，替代原先手填整段 JSON；
       * 改成 keyframe 再补一行 first_frame 图即可走首帧模式。 */
      fields: kind === "video" ? defaultVideoFields() : [],
      running: false,
      result: null,
    });
  }

  async function runUsageTest() {
    if (!usageTest || usageTest.running) return;
    setUsageTest({ ...usageTest, running: true, result: null });
    /* 弹窗留空 → 用草稿条目里的密钥（未保存的条目也有）：
     * 只靠服务端按名字查已保存配置，会漏掉「加了条目还没点保存」的情况，
     * 表现为 401 未提供令牌。（空串显式回落，不能用 ?? —— ?? 不处理空串） */
    const typedKey = usageTest.apiKey.trim();
    const out = await c.testModelUsage({
      kind: usageTest.kind,
      name: usageTest.entry.name,
      baseUrl: usageTest.baseUrl.trim(),
      path: usageTest.path.trim(),
      apiKey:
        typedKey !== "" ? typedKey : (usageTest.entry.apiKey ?? undefined),
      prompt: usageTest.prompt,
      size: usageTest.size.trim() || undefined,
      /* 由结构化字段行生成请求体 JSON（替代原先手填整段 JSON）；
       * 视频且 mode=text 时媒体字段已被界面隐藏，这里同样排除，避免 invalid mode */
      extraJson: usageFieldsToJson(usageFieldsToSend(usageTest)) || undefined,
    });
    setUsageTest((prev) =>
      prev ? { ...prev, running: false, result: out } : prev,
    );
  }

  /* ── 「额外字段」行编辑器：增删改某一行 / 把某行设为图片 / 应用 mode 预设。
   *  纯视图交互，不入库；随弹窗关闭即丢弃。 */
  function patchField(index: number, patch: Partial<UsageField>) {
    setUsageTest((prev) => {
      if (!prev) return prev;
      const fields = prev.fields.map((f, i) =>
        i === index ? { ...f, ...patch } : f,
      );
      return { ...prev, fields };
    });
  }
  function addField(key = "") {
    setUsageTest((prev) =>
      prev ? { ...prev, fields: [...prev.fields, { key, value: "" }] } : prev,
    );
  }
  /** 一键添加固定名称字段（images / first_frame / seed 等预设）：
   *  已存在同名行则不重复加，避免堆出无用的空行。 */
  function addPresetField(key: string) {
    setUsageTest((prev) =>
      prev && !hasUsageFieldKey(prev.fields, key)
        ? { ...prev, fields: [...prev.fields, { key, value: "" }] }
        : prev,
    );
  }
  function removeField(index: number) {
    setUsageTest((prev) =>
      prev
        ? { ...prev, fields: prev.fields.filter((_, i) => i !== index) }
        : prev,
    );
  }
  async function pickFieldImage(index: number, file: File | undefined) {
    if (!file) return;
    try {
      const dataUrl = await readImageAsDataUrl(file);
      patchField(index, { value: dataUrl });
    } catch (err) {
      patchField(index, {
        value: `读取图片失败：${err instanceof Error ? err.message : "未知错误"}`,
      });
    }
  }
  /** 随请求发送的字段行：视频 mode=text 时媒体字段已被隐藏（不渲染也不发送），
   *  其余场景原样保留。过滤逻辑读 usage-test-config 的纯函数，视图不重复实现。 */
  function usageFieldsToSend(
    state: NonNullable<typeof usageTest>,
  ): UsageField[] {
    const hideMedia =
      state.kind === "video" && videoModeHidesMedia(state.fields);
    return hideMedia
      ? state.fields.filter((f) => !isMediaField(f.key))
      : state.fields;
  }

  /** 设置视频 mode 快捷值：已有 mode 行则改其值，否则在末尾追加一行。
   *  若引用图从未落到媒体行（images / first_frame / audios）——例如被误
   *  填进了 mode 行或首行默认值——先把它搬移过去再设 mode，避免丢图。 */
  function setVideoMode(mode: string) {
    setUsageTest((prev) => {
      if (!prev) return prev;
      const idx = prev.fields.findIndex((f) => f.key === "mode");
      if (idx >= 0) {
        const fields = prev.fields.map((f, i) =>
          i === idx ? { ...f, value: mode } : f,
        );
        return { ...prev, fields };
      }
      return {
        ...prev,
        fields: [...prev.fields, { key: "mode", value: mode }],
      };
    });
  }

  /** mode 行被图片覆盖时的自愈：把图片搬到 images 行（没有则新建），
   *  mode 值复位为 text——图片不丢、mode 可见可改。 */
  function rescueMediaFromMode(index: number, url: string) {
    setUsageTest((prev) => {
      if (!prev) return prev;
      const fields = prev.fields.map((f, i) =>
        i === index ? { ...f, value: "text" } : f,
      );
      const emptyImgRow = fields.findIndex(
        (f) => f.key.trim() === "images" && f.value.trim() === "",
      );
      if (emptyImgRow >= 0) {
        fields[emptyImgRow] = { key: "images", value: url };
      } else {
        fields.push({ key: "images", value: url });
      }
      return { ...prev, fields };
    });
  }

  /** 添加 / 编辑提交即落库（远端模型清单已无单独的保存按钮）；
   *  失败时弹窗留在原地展示错误。 */
  async function handleDialogSubmit() {
    setAddError(null);
    const baseUrl = addForm.baseUrl.trim();
    if (dialog?.mode === "edit") {
      const result = await c.updateRemoteModel(dialog.original, {
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
    const result = await c.addRemoteModel({
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

  /* 远程模型按用途分组展示（文本 / 图片 / 视频）；kind 缺省的历史条目
   * 按文本模型归组。行内不再重复用途标签 —— 分组本身就是用途。 */
  function remoteModelGroup(
    kind: RemoteModelKind,
    title: string,
    emptyHint: string,
  ) {
    const entries = c.remoteModelList.filter(
      (entry) => (entry.kind ?? "chat") === kind,
    );
    return (
      <div className="border-border bg-surface-1 mb-4 rounded-xl border p-4">
        <div className="mb-3 flex items-center justify-between">
          <span className="text-ink/80 text-sm font-medium">{title}</span>
          <button
            type="button"
            onClick={() => openAddDialog(kind)}
            className="bg-primary hover:bg-primary-hover rounded-lg px-3 py-1.5 text-xs font-semibold text-white transition-colors"
          >
            ＋ 添加模型
          </button>
        </div>
        {entries.length > 0 ? (
          <div className="space-y-1.5">
            {entries.map((entry) => {
              return (
                <div
                  key={entry.name}
                  className="border-border flex items-center gap-2 rounded-lg border px-3 py-2 text-sm"
                >
                  <span className="min-w-0 flex-1 truncate">
                    <span className="text-ink">{entry.name}</span>
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
                  </span>
                  <button
                    type="button"
                    title="按实际用法发起一次真实调用（参数可在弹窗内自定义）"
                    onClick={() => openUsageTest(kind, entry)}
                    className="border-border text-muted-foreground hover:bg-subtle shrink-0 rounded border px-1.5 py-0.5 text-[11px] transition-colors"
                  >
                    测试
                  </button>
                  <button
                    type="button"
                    title="编辑接口地址 / 密钥 / 名称"
                    onClick={() => openEditDialog(entry)}
                    className="border-border text-muted-foreground hover:bg-subtle shrink-0 rounded border px-1.5 py-0.5 text-[11px] transition-colors"
                  >
                    编辑
                  </button>
                  <button
                    type="button"
                    title="移除该模型（即时保存）"
                    onClick={() => void c.removeRemoteModel(entry.name)}
                    className="text-muted-foreground shrink-0 hover:text-rose-500"
                  >
                    ✕
                  </button>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-muted-foreground text-xs">{emptyHint}</p>
        )}
      </div>
    );
  }

  return (
    <div className={`bg-bg flex flex-col overflow-hidden ${className}`}>
      {/* Header bar */}
      <div className="border-border flex items-center gap-3 border-b px-6 py-4">
        <button
          onClick={onClose ?? (() => router.back())}
          className="text-muted-foreground hover:bg-subtle hover:text-ink flex h-9 w-9 items-center justify-center rounded-lg transition-colors"
          title="返回"
        >
          <ArrowLeft size={18} />
        </button>
        <h1 className="text-ink text-lg font-semibold">设置</h1>
      </div>

      <div className="mx-auto flex min-h-0 w-full max-w-[1100px] flex-1 gap-6 px-6 pt-6">
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
        <div className="custom-scrollbar min-w-0 flex-1 overflow-y-auto pb-6">
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

          {/* ═══ 本地模型（Ollama）Section ═══ */}
          {c.section === "llmLocal" && (
            <Card title="本地模型（Ollama）">
              {/* Base URL 仅本地 Ollama 需要；远端的连接参数由模型条目各自携带 */}
              <Field
                label="Base URL"
                value={c.drafts.llm.baseUrl}
                onChange={(value) => c.patchLlm({ baseUrl: value })}
                placeholder="http://localhost:11434/v1"
              />

              {/* Ollama status row */}
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

              {/* Ollama 启动日志：启动期间每秒跟随 log/ollama-runtime.log，
                  让「启动中…」不再是黑盒（同 ComfyUI / Drizzle Studio 的用户
                  可见出口）。 */}

              <div className="border-border bg-surface-1 mb-4 rounded-xl border">
                <div className="flex items-center justify-between px-3 py-2">
                  <span className="text-ink/80 flex items-center gap-2 text-sm font-medium">
                    启动日志（ollama-runtime.log）
                    {c.ollamaLogActive && (
                      <span className="inline-flex items-center gap-1.5 text-[10px] font-normal text-emerald-600 dark:text-emerald-400">
                        <span className="inline-block size-1.5 animate-pulse rounded-full bg-emerald-400" />
                        跟随中
                      </span>
                    )}
                  </span>
                  <div className="flex items-center gap-2">
                    {!ollamaLogFollow && (
                      <button
                        type="button"
                        onClick={() => setOllamaLogFollow(true)}
                        className="bg-primary/90 hover:bg-primary rounded px-2 py-0.5 text-[11px] font-medium text-white"
                      >
                        恢复自动滚动
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => void c.refreshOllamaLog()}
                      className="border-border text-muted-foreground hover:bg-subtle rounded border px-2 py-0.5 text-[11px] transition-colors"
                    >
                      刷新
                    </button>
                  </div>
                </div>
                <div
                  ref={ollamaLogBoxRef}
                  onScroll={onOllamaLogScroll}
                  className="border-border/50 custom-scrollbar mx-3 mb-3 max-h-44 overflow-y-auto rounded-lg bg-black/30 px-3 py-2 font-mono text-[11px] leading-relaxed text-gray-300"
                >
                  {c.ollamaLogText ? (
                    <span className="break-all whitespace-pre-wrap">
                      <AnsiLogText segments={c.ollamaLogSegments} />
                    </span>
                  ) : (
                    <span className="text-muted-foreground">
                      暂无日志 —— 点「启动
                      Ollama」后这里会实时输出拉起过程（spawn
                      参数、启动输出与退出状态）；也可点「刷新」查看
                      最近一次运行日志。
                    </span>
                  )}
                </div>
              </div>

              {/* Model area — 探测到模型时用下拉 + 候选多选；否则退化为手填 */}
              {c.ollamaStatus === "up" && c.ollamaModels.length > 0 ? (
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
              ) : (
                <Field
                  label="模型"
                  value={c.drafts.llm.model}
                  onChange={(value) => c.patchLlm({ model: value })}
                  placeholder="请填写要使用的模型名，如 qwen3:14b"
                />
              )}

              <div className="mb-4 grid grid-cols-2 gap-3">
                <Field
                  label="全局默认温度"
                  value={String(c.drafts.llm.temperature)}
                  onChange={(value) =>
                    c.patchLlm({ temperature: Number(value) || 0 })
                  }
                />
                <Field
                  label="最大 Token"
                  value={String(c.drafts.llm.maxTokens)}
                  onChange={(value) =>
                    c.patchLlm({ maxTokens: Number(value) || 0 })
                  }
                />
              </div>

              {/* 按任务类型配置温度 —— 远端调用同样按这套推荐默认取温度，
                  但不在此暴露配置项 */}
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
                      const override = c.drafts.llm.temperatureByTask?.[key];
                      const isOverridden =
                        override !== undefined && override !== null;
                      const shown =
                        taskTempEdits[key] ??
                        String(
                          isOverridden ? override : meta.defaultTemperature,
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
                              c.setTaskTemperature(key, event.target.value);
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

              <Btn onClick={() => void c.saveLlm()} disabled={c.saving}>
                保存 LLM 配置
              </Btn>
            </Card>
          )}

          {/* ═══ 远程模型（OpenAI 兼容）Section ═══ */}
          {c.section === "llmRemote" && (
            <>
              <Card title="远程模型（OpenAI 兼容）">
                {/* 模型按用途分组：文本（对话）/ 图片 / 视频；kind 缺省的
                    历史条目按文本模型归组，添加时按组预选用途 */}
                {remoteModelGroup(
                  "chat",
                  "文本模型",
                  "还没有文本模型 —— 点击「添加模型」加入对话 / 写作调用的模型。",
                )}
                {remoteModelGroup(
                  "image",
                  "图片模型",
                  "还没有图片模型 —— 点击「添加模型」加入生图 API 使用的模型。",
                )}
                {remoteModelGroup(
                  "video",
                  "视频模型",
                  "还没有视频模型 —— 点击「添加模型」加入视频生成 API 使用的模型。",
                )}

                <p className="text-muted-foreground mb-4 text-[11px] leading-relaxed">
                  此页只维护模型清单，添加 / 编辑 / 移除都会
                  <strong className="text-ink/80">即时保存</strong>
                  ：「测试」按该条目的配置发起一次真实调用（参数可在弹窗内自定义）；带「独立接口／独立密钥」的模型调用时使用条目内配置，其余走已保存的全局连接配置。实际使用哪个模型在工坊运行界面选择。
                </p>
              </Card>

              {/* 「添加 / 编辑模型」弹窗：接口地址 / API Key 可留空回落全局；
                  编辑态密钥「留空不改」，可显式清除。测试连接成功后顺带展示
                  服务端模型清单供点选。 */}
              {dialog && (
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
                        setAddForm((f) => ({
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
                          setAddForm({
                            ...addForm,
                            apiKey: event.target.value,
                          });
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
                        onClick={() => void handleDialogSubmit()}
                        disabled={c.saving || !addForm.model.trim()}
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
              )}

              {/* 「实际使用」测试弹窗：按用途真实调用一次（chat / 生图 / 生视频），
                  路径 / 提示词 / 尺寸 / 额外参数均可自定义输入。 */}
              {usageTest && (
                <div
                  className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4"
                  onClick={() => setUsageTest(null)}
                >
                  <div
                    className="border-border bg-surface max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl border p-5 shadow-2xl"
                    onClick={(event) => event.stopPropagation()}
                  >
                    <div className="mb-4 flex items-center justify-between">
                      <h3 className="u-title">
                        实际调用测试 · {USAGE_TEST_KIND_LABELS[usageTest.kind]}
                      </h3>
                      <button
                        type="button"
                        onClick={() => setUsageTest(null)}
                        className="text-muted-foreground hover:text-ink"
                        aria-label="关闭"
                      >
                        ✕
                      </button>
                    </div>

                    {/* 接口地址 / 端点路径 / API Key 不再展示：
                        弹窗打开时按条目配置预填（openUsageTest），API Key 留空
                        即回落条目密钥——高级定制仍可在模型编辑弹窗里改。 */}
                    <label className="text-ink/80 mb-1.5 block text-sm font-medium">
                      提示词
                    </label>
                    <textarea
                      value={usageTest.prompt}
                      onChange={(event) =>
                        setUsageTest({
                          ...usageTest,
                          prompt: event.target.value,
                        })
                      }
                      rows={2}
                      className="border-border text-ink placeholder:text-muted-foreground/60 focus:border-primary bg-surface-2 mb-3 w-full resize-y rounded-lg border px-3 py-2 text-sm outline-none"
                    />

                    {usageTest.kind === "image" && (
                      <>
                        <label className="text-ink/80 mb-1.5 block text-sm font-medium">
                          尺寸
                        </label>
                        <input
                          type="text"
                          value={usageTest.size}
                          onChange={(event) =>
                            setUsageTest({
                              ...usageTest,
                              size: event.target.value,
                            })
                          }
                          placeholder="1024x1024"
                          className="border-border text-ink placeholder:text-muted-foreground/60 focus:border-primary bg-surface-2 mb-3 w-full rounded-lg border px-3 py-2 text-sm outline-none"
                        />
                      </>
                    )}

                    {usageTest.kind === "video" && (
                      <>
                        <label className="text-ink/80 mb-1.5 block text-sm font-medium">
                          尺寸（可选，留空 = 不传）
                        </label>
                        <input
                          type="text"
                          value={usageTest.size}
                          onChange={(event) =>
                            setUsageTest({
                              ...usageTest,
                              size: event.target.value,
                            })
                          }
                          placeholder="如 720P（Agnes Flash 固定值）或 1280x704"
                          className="border-border text-ink placeholder:text-muted-foreground/60 focus:border-primary bg-surface-2 mb-3 w-full rounded-lg border px-3 py-2 text-sm outline-none"
                        />
                      </>
                    )}

                    <label className="text-ink/80 mb-1.5 block text-sm font-medium">
                      请求体额外字段
                    </label>
                    <p className="text-muted-foreground -mt-1 mb-2 text-[11px]">
                      每个字段用「字段名 + 值」两格填，替代原先手填整段
                      JSON；值可为 文本 / 数字 /
                      图片（点「上传」选本地图片，或点「链接」直接粘贴公网图片地址）。
                      数值自动按数字 / 布尔解析（如 seed 填 42 即数字）。
                    </p>
                    {usageTest.kind !== "chat" && (
                      <p className="text-muted-foreground -mt-1 mb-2 text-[11px]">
                        ⚠ {MEDIA_URL_NOTICE}
                      </p>
                    )}

                    {usageTest.kind === "video" && (
                      <div className="mb-2">
                        <p className="text-ink/70 mb-1 text-xs font-medium">
                          mode 快捷选择（仍可手改任意值）
                        </p>
                        <div className="flex flex-wrap gap-1.5">
                          {VIDEO_MODE_PRESETS.map((m) => {
                            const modeValue = usageTest.fields.find(
                              (f) => f.key === "mode",
                            )?.value;
                            const active =
                              modeValue?.trim() === m &&
                              !isModeValueBroken(modeValue ?? "");
                            return (
                              <button
                                key={m}
                                type="button"
                                onClick={() => setVideoMode(m)}
                                className={`rounded-full border px-2.5 py-1 text-[11px] transition-colors ${
                                  active
                                    ? "border-[var(--primary,#7c5cff)] bg-[var(--primary,#7c5cff)]/15 text-[var(--primary,#7c5cff)]"
                                    : "border-border text-muted-foreground hover:bg-subtle"
                                }`}
                              >
                                {m}
                              </button>
                            );
                          })}
                        </div>
                        {usageTest.fields.map((f) => {
                          if (f.key !== "mode") return null;
                          const hint = VIDEO_MODE_HINT[f.value.trim()];
                          return hint ? (
                            <p
                              key="mode-hint"
                              className="text-muted-foreground mt-1 text-[11px]"
                            >
                              {hint}
                            </p>
                          ) : null;
                        })}
                        {usageTest.fields.map((f) => {
                          if (f.key !== "mode" || !isModeValueBroken(f.value))
                            return null;
                          const i = usageTest.fields.indexOf(f);
                          return (
                            <div
                              key="mode-broken"
                              className="mt-1 rounded-lg border border-dashed border-amber-400/60 bg-amber-50 px-2 py-1.5 text-[11px] text-amber-700 dark:bg-amber-500/10 dark:text-amber-300"
                            >
                              <p>
                                ⚠ mode 的值被图片/链接覆盖了——这正是「reference
                                选中消失」和 400 invalid mode
                                的原因。点下方按钮把图搬到 images
                                行，或直接把输入框改回 text / keyframe /
                                reference。
                              </p>
                              {looksLikeImage(f.value) && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    rescueMediaFromMode(i, f.value.trim())
                                  }
                                  className="mt-1 rounded border border-amber-400/60 px-2 py-0.5 text-[11px] hover:bg-amber-500/10"
                                >
                                  把这张图搬到 images 行，mode 复位为 text
                                </button>
                              )}
                            </div>
                          );
                        })}
                        {videoModeMissingHint(usageTest.fields) && (
                          <p className="mt-1 rounded-lg border border-dashed border-amber-400/60 bg-amber-50 px-2 py-1.5 text-[11px] text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">
                            ⚠ {videoModeMissingHint(usageTest.fields)}
                          </p>
                        )}
                      </div>
                    )}

                    {usageTest.fields.length === 0 && (
                      <p className="text-muted-foreground border-border mb-2 rounded-lg border border-dashed px-3 py-3 text-center text-[11px]">
                        还没有额外字段。点下方「添加字段」可按需补 seed /
                        duration / first_frame 等。
                      </p>
                    )}

                    <div className="mb-2 flex flex-col gap-2">
                      {usageFieldsToSend(usageTest).map((f) => {
                        const i = usageTest.fields.indexOf(f);
                        return (
                          <div
                            key={i}
                            className="flex flex-col gap-1.5"
                          >
                            <div className="flex gap-1.5">
                              <input
                                type="text"
                                value={f.key}
                                onChange={(event) =>
                                  patchField(i, { key: event.target.value })
                                }
                                placeholder="字段名（如 seed / first_frame）"
                                className="border-border text-ink placeholder:text-muted-foreground/60 focus:border-primary bg-surface-2 w-2/5 min-w-0 rounded-lg border px-2 py-1.5 font-mono text-xs outline-none"
                              />
                              <input
                                type="text"
                                value={f.value}
                                onChange={(event) =>
                                  patchField(i, { value: event.target.value })
                                }
                                placeholder={
                                  f.key === "mode"
                                    ? "模式名：text / keyframe / reference（图片请添加 images 行）"
                                    : looksLikeImage(f.value)
                                      ? "已设为图片，可粘贴新的图片地址覆盖"
                                      : "值：文本 / 数字 / 图片地址"
                                }
                                className="border-border text-ink placeholder:text-muted-foreground/60 focus:border-primary bg-surface-2 w-full min-w-0 rounded-lg border px-2 py-1.5 font-mono text-xs outline-none"
                              />
                              {f.key === "mode" ? (
                                <span
                                  className="text-muted-foreground/40 border-border/40 shrink-0 cursor-not-allowed rounded-lg border px-2 py-1.5 text-[11px]"
                                  title="mode 是模式名（text / keyframe / reference），不能填图片；先添加 images / first_frame 行再传图"
                                >
                                  上传
                                </span>
                              ) : (
                                <label
                                  className="text-muted-foreground hover:text-ink border-border hover:bg-subtle flex shrink-0 cursor-pointer items-center gap-1 rounded-lg border px-2 text-[11px] transition-colors"
                                  title="本地上传一张图片作为该字段的值（自动转 data URL）"
                                >
                                  上传
                                  <input
                                    type="file"
                                    accept="image/png,image/jpeg,image/webp,image/gif"
                                    className="hidden"
                                    onChange={(event) =>
                                      void pickFieldImage(
                                        i,
                                        event.target.files?.[0],
                                      )
                                    }
                                  />
                                </label>
                              )}
                              {!(
                                usageTest.kind === "video" &&
                                isMediaField(f.key)
                              ) &&
                                f.key !== "mode" && (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      patchField(i, { value: "https://" })
                                    }
                                    className="text-muted-foreground hover:text-ink border-border hover:bg-subtle shrink-0 rounded-lg border px-2 text-[11px] transition-colors"
                                    title="填入公网图片地址占位，直接改成你的图片 URL 即可"
                                  >
                                    链接
                                  </button>
                                )}
                              <button
                                type="button"
                                onClick={() => removeField(i)}
                                className="text-muted-foreground shrink-0 px-1 text-sm hover:text-red-400"
                                aria-label="删除该字段"
                              >
                                ✕
                              </button>
                            </div>
                            {looksLikeImage(f.value) && (
                              <img
                                src={f.value}
                                alt="字段图片预览"
                                className="border-border/60 max-h-24 w-fit rounded-md border"
                              />
                            )}
                          </div>
                        );
                      })}
                    </div>

                    <button
                      type="button"
                      onClick={() => addField()}
                      className="text-muted-foreground hover:text-ink border-border mb-3 rounded-lg border border-dashed px-3 py-1.5 text-xs transition-colors"
                    >
                      ＋ 添加字段
                    </button>

                    {(usageTest.kind === "image" ||
                      usageTest.kind === "video") && (
                      <div className="mb-3">
                        <p className="text-muted-foreground mb-1.5 text-[11px]">
                          固定名称字段可一键添加，无需手输拼错
                          （images / first_frame / seed 等）：
                        </p>
                        <div className="flex flex-wrap gap-1.5">
                          {USAGE_FIELD_PRESETS.map((preset) => {
                            const already = hasUsageFieldKey(
                              usageTest.fields,
                              preset.key,
                            );
                            return (
                              <button
                                key={preset.key}
                                type="button"
                                onClick={() => addPresetField(preset.key)}
                                title={
                                  already
                                    ? `已有 ${preset.key} 字段行，直接改那行即可`
                                    : preset.hint
                                }
                                className={`rounded-full border px-2 py-1 text-[11px] transition-colors ${
                                  already
                                    ? "text-primary border-[var(--primary,#7c5cff)]/50 bg-[var(--primary,#7c5cff)]/5"
                                    : "text-muted-foreground hover:text-ink border-border hover:bg-subtle"
                                }`}
                              >
                                ＋ {preset.key}
                                {already ? " ✓" : ""}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {(usageTest.kind === "image" ||
                      usageTest.kind === "video") && (
                      <p className="mb-3 rounded-lg bg-amber-100 px-3 py-2 text-[11px] text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">
                        ⚠ 会真实调用生成接口并消耗提供方额度。
                      </p>
                    )}

                    {usageTest.running && (
                      <p className="text-muted-foreground mb-3 flex items-center gap-2 text-xs">
                        <Loader2 size={13} className="animate-spin" />
                        正在按实际用法调用…
                      </p>
                    )}

                    {usageTest.result && !usageTest.running && (
                      <div className="mb-3">
                        {usageTest.result.ok ? (
                          <>
                            <p className="mb-2 rounded-lg bg-emerald-100 px-3 py-2 text-xs text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">
                              {usageTest.result.detail}
                              {usageTest.result.elapsedMs != null &&
                                ` · 耗时 ${(usageTest.result.elapsedMs / 1000).toFixed(1)}s`}
                            </p>
                            {usageTest.result.chatText && (
                              <p className="border-border/50 bg-surface-1 max-h-40 overflow-y-auto rounded-lg border p-3 text-xs whitespace-pre-wrap">
                                {usageTest.result.chatText}
                              </p>
                            )}
                            {usageTest.result.imageUrl && (
                              <img
                                src={usageTest.result.imageUrl}
                                alt="生成结果"
                                className="border-border/50 max-h-56 w-full rounded-lg border"
                              />
                            )}
                            {usageTest.result.videoUrl && (
                              <a
                                href={usageTest.result.videoUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="text-primary text-xs break-all underline underline-offset-2"
                              >
                                打开生成的视频
                              </a>
                            )}
                            {usageTest.result.pending &&
                              usageTest.result.taskId && (
                                <p className="text-muted-foreground text-xs">
                                  任务 ID：{usageTest.result.taskId}
                                  —— 稍后可在提供方后台查看结果。
                                </p>
                              )}
                          </>
                        ) : (
                          <p className="rounded-lg bg-red-100 px-3 py-2 text-xs break-all text-red-700 dark:bg-red-500/10 dark:text-red-300">
                            {usageTest.result.detail}
                          </p>
                        )}
                      </div>
                    )}

                    <div className="mt-4 flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => setUsageTest(null)}
                        className="border-border text-muted-foreground hover:bg-subtle rounded-lg border px-4 py-2 text-sm transition-colors"
                      >
                        关闭
                      </button>
                      <button
                        type="button"
                        onClick={() => void runUsageTest()}
                        disabled={usageTest.running || !usageTest.prompt.trim()}
                        className="bg-primary hover:bg-primary-hover rounded-lg px-4 py-2 text-sm font-semibold text-white transition-colors disabled:opacity-50"
                      >
                        {usageTest.running ? "调用中…" : "执行测试"}
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
                桌面版（ComfyUI Desktop）请直接配置实例根目录（含 ComfyUI/
                子目录与 standalone-env/），便携版配置含 main.py
                的源码根。自动识别 python_embeded / standalone-env / .venv
                解释器，多个环境并存时优先选用装了依赖（torch）的那个。
                {c.comfyStatus?.pathConfigured
                  ? "已配置——ComfyUI 未运行时提交任务会自动拉起。"
                  : "未配置——ComfyUI 未运行时任务会失败。"}
              </p>
              {comfyInstanceType && (
                <div className="-mt-2 mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                  <span className="text-muted-foreground">安装形态</span>
                  <span
                    className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${
                      comfyDesktopManaged
                        ? "bg-[var(--primary,#7c5cff)]/15 text-[var(--primary,#7c5cff)]"
                        : "bg-subtle text-ink/70"
                    }`}
                  >
                    {INSTANCE_KIND_LABEL[comfyInstanceType]}
                  </span>
                  {comfyDesktopManaged && (
                    <span className="text-muted-foreground">
                      端口与启动参数由 Comfy Desktop
                      实例元数据决定，无需在此配置。
                    </span>
                  )}
                </div>
              )}
              {!comfyDesktopManaged && (
                <>
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
                    非 8188 端口会在启动时自动传
                    --port，实际运行端口以设置为准。
                  </p>
                  <Field
                    label="ComfyUI 启动参数（可选）"
                    value={c.drafts.settings.comfyuiExtraArgs}
                    onChange={(value) =>
                      c.patchSettings({ comfyuiExtraArgs: value })
                    }
                    placeholder="例如 --input-directory D:\\ComfyUI-Shared\\input"
                  />
                </>
              )}
              <div className="mb-4 flex items-center gap-2">
                <input
                  id="comfyui-autostart"
                  type="checkbox"
                  className="size-4 accent-[var(--primary,#7c5cff)]"
                  checked={c.drafts.settings.comfyuiAutoStart ?? true}
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
                      : c.comfyStopping || c.comfyStatus?.stopping
                        ? "bg-amber-400"
                        : c.comfyStatus?.starting
                          ? "bg-amber-400"
                          : "bg-rose-400"
                  }`}
                />
                <span className="text-ink/80 text-sm">
                  {c.comfyStatus?.up
                    ? `ComfyUI 运行中${c.comfyStatus.base ? `（${c.comfyStatus.base}）` : ""}`
                    : c.comfyStopping || c.comfyStatus?.stopping
                      ? "ComfyUI 关闭中…"
                      : c.comfyStarting || c.comfyStatus?.starting
                        ? "ComfyUI 正在启动…"
                        : "ComfyUI 未运行"}
                </span>
                <div className="ml-auto flex items-center gap-2">
                  {/* 打开运行中的 ComfyUI 网页界面到系统默认浏览器（同 Drizzle
                      Studio 的「打开查看」语义，走 Node 端命令，不改 Rust） */}
                  <Btn
                    onClick={() => void c.openComfy()}
                    disabled={c.comfyOpening || !c.comfyStatus?.up}
                  >
                    {c.comfyOpening ? "打开中…" : "打开查看"}
                  </Btn>
                  <Btn
                    onClick={() => void c.startComfy()}
                    disabled={
                      c.saving ||
                      c.comfyStarting ||
                      c.comfyStopping ||
                      !!c.comfyStatus?.stopping ||
                      !!c.comfyStatus?.up
                    }
                  >
                    {c.comfyStarting ? "启动中…" : "启动 ComfyUI"}
                  </Btn>
                  <Btn
                    onClick={() => void c.stopComfy()}
                    disabled={
                      c.saving ||
                      c.comfyStopping ||
                      !!c.comfyStatus?.stopping ||
                      !c.comfyStatus?.up
                    }
                  >
                    {c.comfyStopping || c.comfyStatus?.stopping
                      ? "关闭中…"
                      : "关闭 ComfyUI"}
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
                    <span className="break-all whitespace-pre-wrap">
                      <AnsiLogText segments={c.comfyLogSegments} />
                    </span>
                  ) : (
                    <span className="text-muted-foreground">
                      暂无日志 —— 点「启动
                      ComfyUI」后这里会实时输出拉起过程（spawn
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
                  {/* 按钮只看自身动作的在途状态（dbStudioStarting/Stopping/
                      Opening），不看全局 saving——saving 是保存偏好/ComfyUI
                      等共享标志，卡住时曾把三个按钮一起锁死（#92）。
                      状态查询失败（dbStudioStatus 为 null）时按「未运行」
                      处理：启动按钮仍可点，用户不会整组被禁用。 */}
                  <Btn
                    onClick={() => void c.openDbStudio()}
                    disabled={
                      c.dbStudioOpening ||
                      c.dbStudioStarting ||
                      !c.dbStudioStatus?.up
                    }
                  >
                    {c.dbStudioOpening ? "打开中…" : "打开查看"}
                  </Btn>
                  <Btn
                    onClick={() => void c.startDbStudio()}
                    disabled={
                      c.dbStudioStarting || c.dbStudioStatus?.up === true
                    }
                  >
                    {c.dbStudioStarting ? "启动中…" : "启动 Drizzle Studio"}
                  </Btn>
                  <Btn
                    onClick={() => void c.stopDbStudio()}
                    disabled={c.dbStudioStopping || !c.dbStudioStatus?.up}
                  >
                    {c.dbStudioStopping ? "关闭中…" : "关闭 Drizzle Studio"}
                  </Btn>
                </div>
              </div>
              {/* Drizzle Studio 启动日志：启动期间每秒跟随
                  log/drizzle-studio-runtime.log（同 ComfyUI 的用户可见出口） */}
              <div className="border-border bg-surface-1 mt-4 rounded-xl border">
                <div className="flex items-center justify-between px-3 py-2">
                  <span className="text-ink/80 flex items-center gap-2 text-sm font-medium">
                    启动日志（drizzle-studio-runtime.log）
                    {c.dbStudioLogActive && (
                      <span className="inline-flex items-center gap-1.5 text-[10px] font-normal text-emerald-600 dark:text-emerald-400">
                        <span className="inline-block size-1.5 animate-pulse rounded-full bg-emerald-400" />
                        跟随中
                      </span>
                    )}
                  </span>
                  <div className="flex items-center gap-2">
                    {!dbStudioLogFollow && (
                      <button
                        type="button"
                        onClick={() => setDbStudioLogFollow(true)}
                        className="bg-primary/90 hover:bg-primary rounded px-2 py-0.5 text-[11px] font-medium text-white"
                      >
                        恢复自动滚动
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => void c.refreshDbStudioLog()}
                      className="border-border text-muted-foreground hover:bg-subtle rounded border px-2 py-0.5 text-[11px] transition-colors"
                    >
                      刷新
                    </button>
                  </div>
                </div>
                <div
                  ref={dbStudioLogBoxRef}
                  onScroll={onDbStudioLogScroll}
                  className="border-border/50 custom-scrollbar mx-3 mb-3 max-h-44 overflow-y-auto rounded-lg bg-black/30 px-3 py-2 font-mono text-[11px] leading-relaxed text-gray-300"
                >
                  {c.dbStudioLogText ? (
                    <span className="break-all whitespace-pre-wrap">
                      <AnsiLogText segments={c.dbStudioLogSegments} />
                    </span>
                  ) : (
                    <span className="text-muted-foreground">
                      暂无日志 —— 点「启动 Drizzle Studio」后这里会实时输出拉起
                      过程（spawn 参数与 drizzle-kit 输出）；也可点「刷新」查看
                      最近一次启动日志。
                    </span>
                  )}
                </div>
              </div>
              <p className="text-muted-foreground mt-3 text-xs">
                说明：Drizzle Studio 需要本机开发依赖 （node_modules 里的
                drizzle-kit）。双击桌面壳的开发模式可用； 若当前是不可携带完整
                node_modules 的 standalone 打包，启动时会 提示未找到
                drizzle-kit。
              </p>
            </Card>
          )}

          {c.section === "exit" && (
            <Card title="退出与后台服务">
              <p className="text-muted-foreground mb-4 text-sm">
                桌面壳退出时会对应用进程树执行整树强制关闭 （taskkill /T
                /F，被强杀的进程没有清理机会），因此这些开关是
                「拉起时」决定后台服务是否脱离进程树，不是退出那一刻再选。
                改动后<strong className="text-ink/80">下一次拉起才生效</strong>
                。
              </p>
              <div className="mb-4">
                <div className="flex items-center gap-2">
                  <input
                    id="exit-kill-comfyui"
                    type="checkbox"
                    className="size-4 accent-[var(--primary,#7c5cff)]"
                    checked={c.drafts.settings.exitKillComfyui ?? true}
                    onChange={(event) =>
                      c.patchSettings({
                        exitKillComfyui: event.target.checked,
                      })
                    }
                  />
                  <label
                    htmlFor="exit-kill-comfyui"
                    className="text-ink/80 text-sm"
                  >
                    关闭应用时连带关闭 ComfyUI
                  </label>
                </div>
                <p className="text-muted-foreground mt-1.5 text-xs">
                  勾选（默认）：ComfyUI 由本应用拉起并挂在应用进程内，应用退出
                  时一并关闭；取消勾选：ComfyUI 脱离进程树保活，退出应用后继续
                  运行，下次打开直接复用。仅对本应用拉起的实例生效；手动在其他
                  终端/窗口启动的 ComfyUI 不受此开关影响。
                </p>
              </div>
              <div className="mb-4">
                <div className="flex items-center gap-2">
                  <input
                    id="exit-kill-ollama"
                    type="checkbox"
                    className="size-4 accent-[var(--primary,#7c5cff)]"
                    checked={c.drafts.settings.exitKillOllama ?? true}
                    onChange={(event) =>
                      c.patchSettings({
                        exitKillOllama: event.target.checked,
                      })
                    }
                  />
                  <label
                    htmlFor="exit-kill-ollama"
                    className="text-ink/80 text-sm"
                  >
                    关闭应用时连带关闭 Ollama
                  </label>
                </div>
                <p className="text-muted-foreground mt-1.5 text-xs">
                  语义同上。取消勾选后 Ollama 保活，重启应用可继续复用已加载的
                  模型。仅对本应用拉起的 serve 进程生效；Ollama 注册为系统服务
                  或你手动启动的不受此开关影响。
                </p>
              </div>
              <div className="border-border bg-surface-1 mb-4 rounded-lg border px-3 py-2">
                <p className="text-ink/80 mb-1 text-sm font-medium">
                  关于 Drizzle Studio
                </p>
                <p className="text-muted-foreground text-xs">
                  数据库（SQLite）由 better-sqlite3 内嵌进应用进程，没有独立
                  进程可「关」——应用退出即随之关闭，无需、也无法单独保活。
                  此项仅作说明，不提供开关。
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Btn onClick={() => void c.savePrefs()} disabled={c.saving}>
                  保存偏好
                </Btn>
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── 启动日志 ANSI 颜色渲染 ─────────────────────────────────
 * 纯映射：lib/log-ansi 解析出的样式键 → tailwind class，无业务逻辑。
 * 未知样式键回退默认色，保证新增键不会渲染成透明文本。 */
const ANSI_STYLE_CLASS: Record<AnsiStyleKey, string> = {
  bold: "font-bold",
  dim: "opacity-60",
  italic: "italic",
  underline: "underline",
  red: "text-red-400",
  green: "text-green-400",
  yellow: "text-yellow-300",
  blue: "text-blue-400",
  magenta: "text-fuchsia-400",
  cyan: "text-cyan-300",
  white: "text-white",
  gray: "text-gray-500",
  "red-bright": "text-red-300",
  "green-bright": "text-green-300",
  "yellow-bright": "text-yellow-200",
  "blue-bright": "text-blue-300",
  "magenta-bright": "text-fuchsia-300",
  "cyan-bright": "text-cyan-200",
  "white-bright": "text-white",
  "red-bg": "bg-red-900/60",
  "green-bg": "bg-green-900/60",
  "yellow-bg": "bg-yellow-800/60",
  "blue-bg": "bg-blue-900/60",
  "magenta-bg": "bg-fuchsia-900/60",
  "cyan-bg": "bg-cyan-900/60",
  "white-bg": "bg-gray-600/60",
};

function AnsiLogText({ segments }: { segments: AnsiSegment[] }) {
  return (
    <>
      {segments.map((seg, i) =>
        seg.styles && seg.styles.length > 0 ? (
          <span
            key={i}
            className={seg.styles
              .map((style) => ANSI_STYLE_CLASS[style])
              .filter(Boolean)
              .join(" ")}
          >
            {seg.text}
          </span>
        ) : (
          <span key={i}>{seg.text}</span>
        ),
      )}
    </>
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
