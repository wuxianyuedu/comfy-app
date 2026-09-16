// ── Shared LLM types ─────────────────────────────────────────
// Both local (Ollama / LM Studio / vLLM) and remote (OpenAI-compatible)
// providers speak the OpenAI /v1/chat/completions protocol.

export type LLMProviderType = "local" | "remote";

/** 已知的任务类型 key —— 用于按场景选择不同温度。
 *  `defaultTemperature` 是该任务类型未配置覆盖时的推荐默认值（取 hint 区间中位），
 *  不再一律回落到全局 0.7。 */
export const TASK_TYPES = {
  txt2img: {
    label: "文生图",
    desc: "严谨确定，保证输出稳定可复现",
    hint: "0.1~0.3",
    defaultTemperature: 0.2,
  },
  img2video: {
    label: "图生视频",
    desc: "中低随机性，平衡连贯性与变化",
    hint: "0.3~0.5",
    defaultTemperature: 0.4,
  },
  chat: {
    label: "对话聊天",
    desc: "自然平衡，日常交互默认档位",
    hint: "0.6~0.8",
    defaultTemperature: 0.7,
  },
  code: {
    label: "代码生成",
    desc: "极低随机性，输出精确符合语法",
    hint: "0.05~0.2",
    defaultTemperature: 0.1,
  },
  creative: {
    label: "创意写作",
    desc: "高发散性，激发灵感与多样性",
    hint: "0.9~1.2",
    defaultTemperature: 1.0,
  },
} as const;

export type TaskType = keyof typeof TASK_TYPES;

/** 远端模型的用途：对话（语言模型）/ 图片 / 视频。当前仅对话参与运行时，
 *  图片 / 视频模型先落配置，供后续远程生图 / 生视频接入。 */
export const REMOTE_MODEL_KINDS = ["chat", "image", "video"] as const;
export type RemoteModelKind = (typeof REMOTE_MODEL_KINDS)[number];
export const REMOTE_MODEL_KIND_LABELS: Record<RemoteModelKind, string> = {
  chat: "对话",
  image: "图片",
  video: "视频",
};

/** 远端候选模型条目：baseUrl / apiKey 缺省（或 null）时回落到全局连接参数。 */
export interface RemoteModelEntry {
  name: string;
  baseUrl?: string | null;
  apiKey?: string | null;
  kind?: RemoteModelKind | null;
}

/** extraModels 的原始存储 / 传输形状：旧数据是纯名字字符串，新数据是条目对象。 */
export type RawExtraModel = string | RemoteModelEntry;

/** 把 DB / 请求载荷里的 extraModels 归一化成条目数组（丢弃无名与空白项）。 */
export function normalizeExtraModels(raw: unknown): RemoteModelEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: RemoteModelEntry[] = [];
  const kinds: readonly string[] = REMOTE_MODEL_KINDS;
  for (const item of raw) {
    if (typeof item === "string") {
      if (item.trim() !== "")
        out.push({ name: item, baseUrl: null, apiKey: null, kind: null });
      continue;
    }
    if (typeof item !== "object" || item === null) continue;
    const rec = item as Record<string, unknown>;
    const name = typeof rec.name === "string" ? rec.name.trim() : "";
    if (name === "") continue;
    const kind: unknown = rec.kind;
    out.push({
      name,
      baseUrl:
        typeof rec.baseUrl === "string" && rec.baseUrl.trim() !== ""
          ? rec.baseUrl
          : null,
      apiKey:
        typeof rec.apiKey === "string" && rec.apiKey.trim() !== ""
          ? rec.apiKey
          : null,
      kind:
        typeof kind === "string" && kinds.includes(kind)
          ? (kind as RemoteModelKind)
          : null,
    });
  }
  return out;
}

/** 取候选模型的名字（兼容旧字符串与新条目两种形状）。 */
export function extraModelName(entry: RawExtraModel): string {
  return typeof entry === "string" ? entry : entry.name;
}

/** option C 的拆分结果：本地 ollama 候选（纯名字，无 apiKey）与远端独立模型分开。 */
export interface ExtraModelSplit {
  /** 本地 Ollama 候选模型名（无 apiKey）。 */
  localNames: string[];
  /** 远端独立模型条目（可带独立 baseUrl / apiKey）。 */
  remoteEntries: RemoteModelEntry[];
}

/**
 * 把 DB / 请求里的候选列表按「类型」拆成本地与远端两堆：
 *   字符串 → 本地候选名；对象 → 远端条目。
 * 用于设置页保存时的写入分派与工坊分组下拉的静态来源。
 */
export function splitExtraModels(raw: unknown): ExtraModelSplit {
  const localNames: string[] = [];
  const remoteEntries: RemoteModelEntry[] = [];
  if (!Array.isArray(raw)) return { localNames, remoteEntries };
  for (const item of raw) {
    if (typeof item === "string") {
      const n = item.trim();
      if (n !== "" && !localNames.includes(n)) localNames.push(n);
      continue;
    }
    if (typeof item !== "object" || item === null) continue;
    const rec = item as Record<string, unknown>;
    const name = typeof rec.name === "string" ? rec.name.trim() : "";
    if (name === "") continue;
    if (remoteEntries.some((e) => e.name === name)) continue;
    const kind: unknown = rec.kind;
    remoteEntries.push({
      name,
      baseUrl:
        typeof rec.baseUrl === "string" && rec.baseUrl.trim() !== ""
          ? rec.baseUrl
          : null,
      apiKey:
        typeof rec.apiKey === "string" && rec.apiKey.trim() !== ""
          ? rec.apiKey
          : null,
      kind:
        typeof kind === "string" &&
        REMOTE_MODEL_KINDS.includes(kind as RemoteModelKind)
          ? (kind as RemoteModelKind)
          : null,
    });
  }
  return { localNames, remoteEntries };
}

/**
 * 判断目标服务是否为本地回环（localhost / 127.x / [::1]）—— 本地 Ollama 等
 * 回环服务；真远端模型不会用回环地址访问。与服务端 describeFetchFailure 的判定一致。
 */
export function isLoopbackBaseUrl(url: string): boolean {
  return /^(https?:\/\/)?(localhost|127\.|\[::1\])/i.test(
    String(url ?? "").trim(),
  );
}

/** 判定一个「远端条目」是否为误存的本地 ollama。
 *  本地 ollama 候选不带 apiKey，且接口指向本地回环；真远端独立模型必有独立密钥，
 *  或指向非回环地址（否则无法从本机之外访问）。option C 前历史版本把本地 ollama
 *  候选也存成对象、或迁移把这类条目整体搬进了 remoteModel 表，导致本机 ollama 在
 *  工坊下拉 / 设置页被当「远端」挂小标。命中该判定的条目应归入本地候选而非远端组。
 *  入参 baseUrl 为空的条目回落到全局 llmConfig.baseUrl 参与判定。 */
export function isMisplacedLocalOllama(
  e: { apiKey?: string | null; baseUrl?: string | null },
  llmBaseUrl: string | null | undefined,
): boolean {
  if (e.apiKey) return false; // 带独立密钥 = 真远端
  const effective = e.baseUrl?.trim() ? e.baseUrl : (llmBaseUrl ?? "");
  return isLoopbackBaseUrl(effective);
}

/** 把「远端条目堆 + 本地候选名」按上面判定归并成本/远端两组：
 *  误存的本地 ollama 折回本地候选名，真远端条目保留。调用点据此重建下发给客户端的
 *  候选清单（字符串=本地、对象=远端），也让设置页保存时能把误存条目顺带清出远端表。 */
export function foldRemoteToLocal(
  remoteEntries: RemoteModelEntry[],
  localNames: string[],
  llmBaseUrl: string | null | undefined,
): ExtraModelSplit {
  const locals = localNames.slice();
  const remotes: RemoteModelEntry[] = [];
  for (const e of remoteEntries) {
    if (isMisplacedLocalOllama(e, llmBaseUrl)) {
      if (!locals.includes(e.name)) locals.push(e.name);
    } else {
      remotes.push(e);
    }
  }
  return { localNames: locals, remoteEntries: remotes };
}

/** 生效提供方判定（工坊分组 / 徽标 / 页脚的统一口径）：
 *  baseUrl 指向本机回环且未配密钥时，即便存储的 provider 是 remote 也按
 *  「本地」——本机 Ollama/LM Studio 被存成「远端 API」（历史迁移 / 设置表单
 *  误选）时，工坊下拉会把 ollama 模型挂「远端」小标、可用性探测也走错通道。
 *  带 apiKey 的回环地址可能是本机网关转发远端计费模型，尊重存储值不强行改判；
 *  provider 已是 local 的一律保持 local（局域网自建服务仍算本地）。 */
export function effectiveProviderType(
  provider: LLMProviderType,
  baseUrl: string | null | undefined,
  hasApiKey: boolean,
): LLMProviderType {
  if (provider === "remote" && !hasApiKey && isLoopbackBaseUrl(baseUrl ?? "")) {
    return "local";
  }
  return provider;
}

/**
 * 任务温度解析（设置覆盖与推荐默认的唯一裁决点）：
 *   该任务的用户覆盖值 → 调用方显式指定的温度 → 该任务推荐默认 → 全局默认。
 */
export function resolveTaskTemperature(opts: {
  taskType?: TaskType;
  explicitTemperature?: number | null;
  overrides?: Record<TaskType, number> | null;
  fallback: number;
}): number {
  const { taskType, explicitTemperature, overrides, fallback } = opts;
  if (taskType && overrides?.[taskType] != null) return overrides[taskType];
  if (explicitTemperature != null) return explicitTemperature;
  if (taskType) return TASK_TYPES[taskType].defaultTemperature;
  return fallback;
}

export interface LLMConfig {
  provider: LLMProviderType;
  /** OpenAI-compatible base URL: 本机 Ollama 默认值见 `@/lib/endpoints`
   *  （`OLLAMA_DEFAULT_BASE_URL`），也可以指向任意远端 `https://…/v1`。 */
  baseUrl: string;
  model: string;
  /** 候选模型（设置页可配置多个）：本地 Ollama 为纯名字；远端条目可带独立 baseUrl / apiKey */
  extraModels?: RemoteModelEntry[] | null;
  /** remote 提供方的密钥；与 RemoteModelEntry.apiKey 一样只在服务端参与请求 */
  apiKey?: string | null;
  /** 全局默认温度（未区分任务类型的调用的 fallback） */
  temperature: number;
  /** 按任务类型覆盖的温度；缺失某 key 时回退到该任务的推荐默认值 */
  temperatureByTask?: Record<TaskType, number> | null;
  maxTokens: number;
}

/** Config shape sent to / shared with the browser (apiKey is masked). */
export interface LLMConfigView {
  provider: LLMProviderType;
  baseUrl: string;
  model: string;
  /** 候选模型名（条目已归一成名字下发，供工坊内切换；连接参数不下发） */
  extraModels?: string[] | null;
  temperature: number;
  temperatureByTask?: Record<TaskType, number> | null;
  maxTokens: number;
  hasApiKey: boolean;
}

export interface LLMMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  /** 仅 role === "assistant" 时可能出现：携带 tool_calls 的消息回灌。 */
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
  /** 仅 role === "tool" 时需要：标识对应哪个 tool_call。 */
  tool_call_id?: string;
}
/** OpenAI function calling 工具定义（OpenAI 兼容 /chat/completions 的 tools 参数）。 */
export interface LLMTool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters?: Record<string, unknown>;
  };
}

/** OpenAI 兼容响应中的 tool_call 条目。 */
export interface LLMToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

/** 工坊阶段的 key —— 供按阶段挑选模型 / 提示各阶段能力 */
export const WORKSHOP_STAGES = [
  { id: "script", label: "剧本" },
  { id: "character", label: "角色卡" },
  { id: "storyboard", label: "分镜" },
  { id: "prompt", label: "图片提示词" },
] as const;

export type WorkshopStage = (typeof WORKSHOP_STAGES)[number]["id"];

export interface LLMRequestOptions {
  provider?: LLMProviderType;
  baseUrl?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  /** 调用方指定的任务类型，用于查找 temperatureByTask 覆盖 */
  taskType?: TaskType;
  /** OpenAI 兼容 function calling 的工具列表（可选，Agent 指挥用）。 */
  tools?: LLMTool[];
}
