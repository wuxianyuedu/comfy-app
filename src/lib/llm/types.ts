// ── Shared LLM types ─────────────────────────────────────────
// Both local (Ollama / LM Studio / vLLM) and remote (OpenAI-compatible)
// providers speak the OpenAI /v1/chat/completions protocol.

export type LLMProviderType = "local" | "remote";

/** 已知的任务类型 key —— 用于按场景选择不同温度。
 *  `defaultTemperature` 是该任务类型未配置覆盖时的推荐默认值（取 hint 区间中位），
 *  不再一律回落到全局 0.7。 */
export const TASK_TYPES = {
  txt2img: { label: "文生图", desc: "严谨确定，保证输出稳定可复现", hint: "0.1~0.3", defaultTemperature: 0.2 },
  img2video: { label: "图生视频", desc: "中低随机性，平衡连贯性与变化", hint: "0.3~0.5", defaultTemperature: 0.4 },
  chat: { label: "对话聊天", desc: "自然平衡，日常交互默认档位", hint: "0.6~0.8", defaultTemperature: 0.7 },
  code: { label: "代码生成", desc: "极低随机性，输出精确符合语法", hint: "0.05~0.2", defaultTemperature: 0.1 },
  creative: { label: "创意写作", desc: "高发散性，激发灵感与多样性", hint: "0.9~1.2", defaultTemperature: 1.0 },
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
      if (item.trim() !== "") out.push({ name: item, baseUrl: null, apiKey: null, kind: null });
      continue;
    }
    if (typeof item !== "object" || item === null) continue;
    const rec = item as Record<string, unknown>;
    const name = typeof rec.name === "string" ? rec.name.trim() : "";
    if (name === "") continue;
    const kind: unknown = rec.kind;
    out.push({
      name,
      baseUrl: typeof rec.baseUrl === "string" && rec.baseUrl.trim() !== "" ? rec.baseUrl : null,
      apiKey: typeof rec.apiKey === "string" && rec.apiKey.trim() !== "" ? rec.apiKey : null,
      kind: typeof kind === "string" && kinds.includes(kind) ? (kind as RemoteModelKind) : null,
    });
  }
  return out;
}

/** 取候选模型的名字（兼容旧字符串与新条目两种形状）。 */
export function extraModelName(entry: RawExtraModel): string {
  return typeof entry === "string" ? entry : entry.name;
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
  /** OpenAI-compatible base URL, e.g. http://localhost:11434/v1 or https://api.openai.com/v1 */
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
  role: "system" | "user" | "assistant";
  content: string;
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
}
