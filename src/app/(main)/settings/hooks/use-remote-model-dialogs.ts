"use client";

/**
 * 远程模型（OpenAI 兼容）管理的交互状态与动作（规范 17 §17.2 第②层）。
 *
 * 之前这些状态与动作内联在 `SettingsPageView.tsx` 里（约 470 行），与 JSX 混在
 * 一个文件：网络侧动作（`probeRemote` / `testModelUsage` / `queryUsageTask` /
 * 增删改模型）本就在 controller，这里只收拢**弹窗交互状态**——表单草稿、
 * 进行态、测试结果、额外字段行编辑——让视图只消费字段、只渲染 JSX。
 *
 * 模块级草稿仓库（`usageTestDrafts`）一并搬来：它按 `kind + 条目名` 保留
 * 「关闭再重开」的表单内容，是纯视图偏好，不入库。
 */

import { useEffect, useState } from "react";

import {
  defaultVideoFields,
  hasUsageFieldKey,
  isMediaField,
  usageFieldsToJson,
  usageTestDraftKey,
  videoModeHidesMedia,
  type UsageField,
} from "~/lib/llm/usage-test-config";
import type {
  UsageTestKind,
  UsageTestResult,
} from "~/lib/llm/usage-test-client";
import type { RemoteModelEntry, RemoteModelKind } from "~/lib/llm/types";

import type { ReadySettingsPageController } from "./use-settings-page";

/** 添加 / 编辑模型弹窗的表单草稿。 */
export interface ModelDialogForm {
  baseUrl: string;
  apiKey: string;
  model: string;
  /** 用途：对话（默认）/ 图片 / 视频——图片 / 视频模型先落配置，供远程生成接入。 */
  kind: RemoteModelKind;
}

export type ModelDialog =
  | { mode: "add" }
  | { mode: "edit"; original: string; entry: RemoteModelEntry }
  | null;

/** 「实际使用」测试弹窗的状态：参数可自定义，结果按用途渲染。 */
export interface UsageTestDialogState {
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
  /** 是否正在「继续等待」一个已提交的异步视频任务（区别于首次提交的 running） */
  querying: boolean;
  result: UsageTestResult | null;
}

/** 每个条目「实际使用」测试弹窗的草稿快照：不含运行时 running / entry 引用，
 *  只保留「重开可恢复」的填写内容与最近一次执行结果 / 状态。
 *  关闭弹窗不丢内容（ISSUE #107）：重开同一 kind + 条目的弹窗时据此恢复。 */
export interface UsageTestDialogSnapshot {
  kind: UsageTestKind;
  name: string;
  baseUrl: string;
  path: string;
  apiKey: string;
  prompt: string;
  size: string;
  fields: UsageField[];
  result: UsageTestResult | null;
}

/** 模块级草稿仓库：键 = usageTestDraftKey(kind, name)。
 *  放在模块作用域而非组件 state，是为了「关闭弹窗」也能保留——
 *  关闭只把组件内的 usageTest 置 null，仓库里的快照仍在，重开即恢复。 */
const usageTestDrafts = new Map<string, UsageTestDialogSnapshot>();

/** 把当前弹窗状态压成可恢复的快照存进仓库。running 恒不存：关闭再重开不应
 *  误认为「还在跑」，最近一次执行的结果在 result 里体现即可。 */
function rememberUsageTestDraft(state: UsageTestDialogState): void {
  const key = usageTestDraftKey(state.kind, state.entry.name);
  usageTestDrafts.set(key, {
    kind: state.kind,
    name: state.entry.name,
    baseUrl: state.baseUrl,
    path: state.path,
    apiKey: state.apiKey,
    prompt: state.prompt,
    size: state.size,
    fields: state.fields.map((f) => ({ ...f })),
    result: state.result,
  });
}

/** 若存在对应草稿快照则返回，否则返回 null（调用方按默认值新建弹窗）。 */
function restoreUsageTestDraft(
  kind: UsageTestKind,
  name: string,
): UsageTestDialogSnapshot | null {
  return usageTestDrafts.get(usageTestDraftKey(kind, name)) ?? null;
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

/** 每个模型条目的「测试连接」进行态与结果。 */
export interface RowProbe {
  name: string;
  running: boolean;
  msg: { kind: "ok" | "err"; text: string } | null;
}

export interface RemoteModelDialogs {
  /** 「添加 / 编辑模型」弹窗状态（null = 关闭）。 */
  dialog: ModelDialog;
  closeDialog: () => void;
  addForm: ModelDialogForm;
  setAddForm: React.Dispatch<React.SetStateAction<ModelDialogForm>>;
  /** 弹窗内提交失败的错误文案（留在原地展示）。 */
  addError: string | null;
  /** 编辑态显式清除独立密钥的勾选。 */
  clearKey: boolean;
  setClearKey: React.Dispatch<React.SetStateAction<boolean>>;
  /** 弹窗内「测试连接」的进行态与结果。 */
  testing: boolean;
  testMsg: { kind: "ok" | "err"; text: string } | null;
  /** 测试连接成功后返回的服务端模型清单（供点选）。 */
  suggestions: string[];
  /** 提交添加 / 编辑（即时落库；失败留在弹窗报错）。 */
  submitDialog: () => Promise<void>;
  /** 打开「添加模型」弹窗，按用途预选用途。 */
  openAddDialog: (kind?: RemoteModelKind) => void;
  /** 打开「编辑模型」弹窗（密钥留空不改）。 */
  openEditDialog: (entry: RemoteModelEntry) => void;
  /** 弹窗内「测试连接」（编辑态密钥留空 = 沿用已保存密钥）。 */
  testConnection: () => Promise<void>;

  /** 条目行内「测试连接」：只探测连通性，不消耗额度。 */
  rowProbe: RowProbe | null;
  runEntryConnectionTest: (entry: RemoteModelEntry) => Promise<void>;

  /** 「实际使用」测试弹窗状态（null = 关闭）。 */
  usageTest: UsageTestDialogState | null;
  /** 打开「实际使用」测试弹窗（按用途预填，重开恢复草稿）。 */
  openUsageTest: (kind: UsageTestKind, entry: RemoteModelEntry) => void;
  /** 关闭「实际使用」弹窗（草稿仍在仓库，重开可恢复）。 */
  closeUsageTest: () => void;
  /** 局部更新弹窗里的受控输入（提示词 / 尺寸等）。 */
  patchUsageTest: (patch: Partial<UsageTestDialogState>) => void;
  /** 发起一次真实调用（图片 / 视频会真实生成、消耗额度）。 */
  runUsageTest: () => Promise<void>;
  /** 对已提交但仍在生成的异步视频任务「继续等待」一轮。 */
  continueUsageWait: () => Promise<void>;
  /** 额外字段行编辑：增 / 改 / 删 / 设为图片 / 应用 mode 预设。 */
  patchField: (index: number, patch: Partial<UsageField>) => void;
  addField: (key?: string) => void;
  addPresetField: (key: string) => void;
  removeField: (index: number) => void;
  pickFieldImage: (index: number, file: File | undefined) => Promise<void>;
  setVideoMode: (mode: string) => void;
  rescueMediaFromMode: (index: number, url: string) => void;
  /** 随请求发送的字段行（视频 mode=text 时剔除已隐藏的媒体字段）。 */
  usageFieldsToSend: (state: UsageTestDialogState) => UsageField[];
}

/**
 * 远程模型管理的弹窗交互状态与动作。
 *
 * @param c 设置页 controller（网络侧动作都在它上面）
 */
export function useRemoteModelDialogs(
  c: ReadySettingsPageController,
): RemoteModelDialogs {
  const [dialog, setDialog] = useState<ModelDialog>(null);
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
  const [usageTest, setUsageTest] = useState<UsageTestDialogState | null>(null);
  const [rowProbe, setRowProbe] = useState<RowProbe | null>(null);

  /* 弹窗打开期间每次状态变化都存入草稿仓库：这样无论点关闭 / ✕ / 点遮罩，
   * 关闭后的下次重开都能从仓库恢复已填内容与最近一次执行结果。 */
  useEffect(() => {
    if (usageTest) rememberUsageTestDraft(usageTest);
  }, [usageTest]);

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

  function closeDialog() {
    setDialog(null);
  }

  async function testConnection() {
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

  /** 按某条模型条目自身配置探测连通性（「测试连接」）。
   *  探测只验证接口地址 / 密钥是否可达、可列出模型，不发起生成调用、不耗额度；
   *  结果内联展示在该条目下方。独立接口 / 独立密钥缺省时回落已保存的全局连接配置。 */
  async function runEntryConnectionTest(entry: RemoteModelEntry) {
    if (rowProbe?.running && rowProbe.name === entry.name) return;
    setRowProbe({ name: entry.name, running: true, msg: null });
    try {
      const out = await c.probeRemote({
        baseUrl: entry.baseUrl ?? undefined,
        apiKey: entry.apiKey ?? undefined,
      });
      setRowProbe({
        name: entry.name,
        running: false,
        msg: { kind: out.ok ? "ok" : "err", text: out.detail },
      });
    } catch {
      setRowProbe({
        name: entry.name,
        running: false,
        msg: { kind: "err", text: "连接测试失败，请检查接口地址与网络" },
      });
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
    /* 若该 kind + 条目此前打开过并填过内容（含上次执行结果 / 状态），
     * 关闭后重开时恢复，而不是回到默认预填——内容不因关闭而丢。 */
    const prev = restoreUsageTestDraft(kind, entry.name);
    setUsageTest({
      kind,
      entry,
      baseUrl: prev?.baseUrl ?? base,
      path: prev?.path ?? path,
      apiKey: prev?.apiKey ?? "",
      prompt: prev?.prompt ?? preset.prompt,
      size: prev?.size ?? "",
      /* 视频接口普遍必填 mode（如 Agnes：text / keyframe / reference）。
       * 这里直接给一行可见、可改的 mode 字段，替代原先手填整段 JSON；
       * 改成 keyframe 再补一行 first_frame 图即可走首帧模式。 */
      fields:
        prev?.fields && prev.fields.length > 0
          ? prev.fields.map((f) => ({ ...f }))
          : kind === "video"
            ? defaultVideoFields()
            : [],
      /* 关闭再重开不延续「运行中」——从草稿恢复的是已填内容 + 最近一次结果 */
      running: false,
      querying: false,
      result: prev?.result ?? null,
    });
  }

  function closeUsageTest() {
    setUsageTest(null);
  }

  function patchUsageTest(patch: Partial<UsageTestDialogState>) {
    setUsageTest((prev) => (prev ? { ...prev, ...patch } : prev));
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
      prev ? { ...prev, running: false, querying: false, result: out } : prev,
    );
  }

  /** 对已提交但仍在生成的异步视频任务「继续等待」一轮（同一条目连接参数 +
   *  上次返回的 taskId）。只查既有任务，不重新提交、不重复扣费。 */
  async function continueUsageWait() {
    if (!usageTest || usageTest.querying) return;
    const taskId = usageTest.result?.taskId;
    if (!taskId) return;
    setUsageTest({ ...usageTest, querying: true });
    const typedKey = usageTest.apiKey.trim();
    const out = await c.queryUsageTask({
      name: usageTest.entry.name,
      baseUrl: usageTest.baseUrl.trim(),
      path: usageTest.path.trim(),
      apiKey:
        typedKey !== "" ? typedKey : (usageTest.entry.apiKey ?? undefined),
      taskId,
    });
    setUsageTest((prev) =>
      prev ? { ...prev, querying: false, result: out } : prev,
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
  function usageFieldsToSend(state: UsageTestDialogState): UsageField[] {
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
  async function submitDialog() {
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

  return {
    dialog,
    closeDialog,
    addForm,
    setAddForm,
    addError,
    clearKey,
    setClearKey,
    testing,
    testMsg,
    suggestions,
    submitDialog,
    openAddDialog,
    openEditDialog,
    testConnection,
    rowProbe,
    runEntryConnectionTest,
    usageTest,
    openUsageTest,
    closeUsageTest,
    patchUsageTest,
    runUsageTest,
    continueUsageWait,
    patchField,
    addField,
    addPresetField,
    removeField,
    pickFieldImage,
    setVideoMode,
    rescueMediaFromMode,
    usageFieldsToSend,
  };
}
