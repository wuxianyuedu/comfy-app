/**
 * `provider-types.ts` — 远端模型「供应商 / 模型配置」的共享类型与纯函数（视图层与服务端共用）。
 *
 * 这里只放零依赖的判定与推导：API 格式词表、输入类型 / 模型能力词表、推理等级、
 * 智能配置的启发式推断、上下文窗口的展示格式。真正的请求组装在
 * `~/lib/llm/api-format`，落库在 `~/lib/core/repository-user`。
 *
 * 视图层 import 本模块是安全的（不碰 node 内建、不碰 server-only）。
 *
 * @module lib/llm/provider-types
 */

import { EMPTY_PLACEHOLDER } from "~/lib/display-value";
import { isRecord } from "~/lib/is-record";
import { trimFixed } from "~/lib/number-format";

/** 上游接口协议格式。Base URL 由用户填写（**不带版本段**，如
 *  `https://api.example.com`），版本段与动作路径由应用按格式拼接（#3656）：
 *  · `chat-completions` → `{base}/v1/chat/completions`（OpenAI 兼容，最通用）
 *  · `anthropic-messages` → `{base}/v1/messages`（Anthropic Messages）
 *  · `responses` → `{base}/v1/responses`（OpenAI Responses）
 *  拼接规则见 `joinApiUrl()`：Base 已带版本段（历史行 / 本地 Ollama 默认地址）
 *  时不再重复补，动作路径自带版本段时也不叠。
 *
 *  #3517 起格式挂在**模型**上（同一供应商下文本 / 图片 / 视频模型可能各用一套
 *  协议），供应商那一格只是历史行与新模型的默认值，见 `resolveApiFormat()`。 */
/* SAFETY: 类型断言已复核 */
export const LLM_API_FORMATS = ["chat-completions", "anthropic-messages", "responses"] as const;
export type LlmApiFormat = (typeof LLM_API_FORMATS)[number];

export const LLM_API_FORMAT_LABELS: Record<LlmApiFormat, string> = {
  "chat-completions": "Chat Completions（/v1/chat/completions）",
  "anthropic-messages": "Anthropic Messages（/v1/messages）",
  responses: "Responses（/v1/responses）",
};

/** 行内摘要用的短标签（模型行那句「上下文 … · 输出 …」用它：完整标签带路径段，太宽）。 */
export const LLM_API_FORMAT_SHORT_LABELS: Record<LlmApiFormat, string> = {
  "chat-completions": "Chat Completions",
  "anthropic-messages": "Anthropic Messages",
  responses: "Responses",
};

/** 格式 → 请求路径段（唯一出处；运行时与设置页的「最终地址」预览都取它）。 */
export const LLM_API_FORMAT_PATHS: Record<LlmApiFormat, string> = {
  "chat-completions": "/chat/completions",
  "anthropic-messages": "/v1/messages",
  responses: "/responses",
};

export function isLlmApiFormat(value: unknown): value is LlmApiFormat {
  const formats: ReadonlyArray<string> = LLM_API_FORMATS;
  return typeof value === "string" && formats.includes(value);
}

/** 生效的接口格式：模型自己的优先 → 供应商默认 → 回落 OpenAI 兼容。
 *
 *  #3517 起格式是**模型级**配置（同一供应商下文本 / 图片模型可能各用一套协议），
 *  供应商那一格只剩「历史行与新模型的默认值」这一层含义。运行时（`entryFromRemoteRow`）
 *  与设置页视图（`modelView`）都走这一个函数，不各写一遍回落顺序。 */
/** Base URL 末段是否「版本段」（`v1` / `v1beta` / `v2` 这类，`/api/v1` 的末段也算）。
 *  与历史上 `baseUrlVersionHint` 的判据同源（末段形如 `v<数字>` 开头的短段）。 */
function hasTrailingVersionSegment(base: string): boolean {
  const pathname: string = (() => {
    try {
      return new URL(base).pathname;
    } catch {
      /* 不是合法 URL（字段校验会在上游拦）——按裸路径判，末段 v1 同样认 */
      return base;
    }
  })();
  const last = pathname.split("/").filter(Boolean).at(-1) ?? "";
  return /^v\d+[a-z0-9]*$/i.test(last);
}

/** 动作路径是否自带版本段（如 Anthropic 的 `/v1/messages`）。 */
function hasLeadingVersionSegment(actionPath: string): boolean {
  return /^\/v\d/i.test(actionPath);
}

/** 最终请求地址的唯一拼装口（#3656）：`joinApiUrl(baseUrl, actionPath)`。
 *
 *  #3656 起的口径是「Base URL 不带版本段，版本段由应用统一补」，所以这里
 *  不是简单字符串相接，规则有三条：
 *  · Base 末段是版本段（历史行填了 `…/v1`、本地 Ollama 默认地址 `…:11434/v1`）
 *    → 原样 + 动作路径，不重复补；
 *  · 动作路径自带版本段（Anthropic 的 `/v1/messages`）且 Base 也带 → Base 的
 *    版本段让位，防 `/v1/v1/messages`；
 *  · 其余（新口径的裸域 Base + 无版本动作路径）→ Base + `/v1` + 动作路径。
 *
 *  空动作路径返回去尾斜杠的 Base 本身；空 Base 返回空串。纯函数，运行时、
 *  探测路由与设置页预览共用这一份，不在各处各拼一遍。 */
export function joinApiUrl(baseUrl: string, actionPath: string): string {
  const base = baseUrl.trim().replace(/\/+$/, "");
  if (base === "") {
    return "";
  }
  /* 空动作路径 = Base 本身就是端点（如「实际使用」弹窗把完整端点填进地址、
   * 路径留空的历史用法）：不补版本段，原样返回。 */
  if (actionPath === "") {
    return base;
  }
  const action = actionPath.startsWith("/") ? actionPath : `/${actionPath}`;
  const baseVersioned = hasTrailingVersionSegment(base);
  if (baseVersioned && hasLeadingVersionSegment(action)) {
    /* Base 的版本段让位：把末段版本剥掉再接自带版本的动作路径 */
    const stripped = base.replace(/\/v\d+[a-z0-9]*$/i, "");
    return `${stripped}${action}`;
  }
  if (baseVersioned || hasLeadingVersionSegment(action)) {
    return `${base}${action}`;
  }
  return `${base}/v1${action}`;
}

/** 生效的接口格式：模型自己的优先 → 供应商默认 → 回落 OpenAI 兼容。
 *
 *  #3517 起格式是**模型级**配置（同一供应商下文本 / 图片模型可能各用一套协议），
 *  供应商那一格只剩「历史行与新模型的默认值」这一层含义。运行时（`entryFromRemoteRow`）
 *  与设置页视图（`modelView`）都走这一个函数，不各写一遍回落顺序。 */
export function resolveApiFormat(...candidates: ReadonlyArray<unknown>): LlmApiFormat {
  for (const candidate of candidates) {
    if (isLlmApiFormat(candidate)) {
      return candidate;
    }
  }
  return "chat-completions";
}

/** 供应商最终请求地址（版本段与动作路径的拼装见 `joinApiUrl`）。空 Base URL 返回空串。 */
export function requestUrlForFormat(baseUrl: string, format: LlmApiFormat): string {
  return joinApiUrl(baseUrl, LLM_API_FORMAT_PATHS[format]);
}

/* ── 已核实的厂商端点提示（#3612）───────────────────────────────── */

type KnownApiEndpoint = {
  /** 厂商真正的 API 主机：Base URL 落在它上面 = 没填错，不再提示。 */
  apiHost: string;
  /** 命中判定：主机名等于该域或以「.该域」结尾（子域一起算）。 */
  domain: string;
  /** 推荐用户照抄的 Base URL（#3656 口径：**不带版本段**，接口端点 = 它 + `/v1`）。 */
  recommendedBaseUrl: string;
  /** 厂商名（提示文案里点名用）。 */
  vendor: string;
};

/**
 * 「接口端点在另一个域」的厂商清单。这是**当面验证过的厂商知识**（数据，不是
 * 启发式扫描）：只收对上游真实行为核实过的条目，不猜。#3612 的现场——
 * `api.agnes-ai.com/api/v1/*` 对**任何**请求（含带任意 Bearer 密钥）都答
 * 401 `Login expired`：那是官网登录态的后端，API 密钥在它面前永远无效；
 * 真正的 OpenAI 兼容端点在 `apihub.agnes-ai.com/v1`（`/models` 不带密钥也
 * 返回模型清单）。这类「401 但密钥没问题」的错，只凭状态码归因会把用户
 * 引去反复换密钥，所以按域名点名指路。
 */
const KNOWN_API_ENDPOINTS: ReadonlyArray<KnownApiEndpoint> = [
  {
    domain: "agnes-ai.com",
    apiHost: "apihub.agnes-ai.com",
    recommendedBaseUrl: "https://apihub.agnes-ai.com",
    vendor: "Agnes",
  },
];

/** Base URL 落在已知厂商的「非接口域」上时给一句指路提示（只提示、不改写）；
 *  返回 `null` 表示不提示。
 *
 *  刻意只在「核实过的域」上开口：对未知域猜「这是控制台域」会误伤把 API 就
 *  架在主域上的服务商。 */
export function knownApiEndpointHint(url: string): string | null {
  let host: string;
  try {
    host = new URL(url.trim()).hostname.toLowerCase();
  } catch {
    return null;
  }
  const entry = KNOWN_API_ENDPOINTS.find(
    (candidate) => host === candidate.domain || host.endsWith(`.${candidate.domain}`),
  );
  if (entry === undefined || host === entry.apiHost) {
    return null;
  }
  return `「${entry.vendor}」的接口端点在 ${entry.recommendedBaseUrl}/v1 —— ${host} 是官网侧的域（只认网页登录态，不接受 API 密钥），请把 Base URL 改成 ${entry.recommendedBaseUrl}（不带 /v1，版本段由应用自动拼接）`;
}

/* ── 模型输入类型 ───────────────────────────────────────────────── */

/* SAFETY: 类型断言已复核 */
export const MODEL_INPUT_TYPES = ["text", "image", "video", "pdf"] as const;
export type ModelInputType = (typeof MODEL_INPUT_TYPES)[number];

export const MODEL_INPUT_TYPE_LABELS: Record<ModelInputType, string> = {
  text: "文本",
  image: "图片",
  video: "视频",
  pdf: "PDF",
};

/* ── 模型输出类型 ───────────────────────────────────────────────── */

/* 输出与输入的词表刻意不共用：输入有 pdf（读文档），输出没有——没有模型
 * 「输出 PDF」；输出也不收 audio（当前工坊不消费，等真接入再扩词表，
 * 免得出现「能配但哪都不生效」的摆设档）。 */
/* SAFETY: 类型断言已复核 */
export const MODEL_OUTPUT_TYPES = ["text", "image", "video"] as const;
export type ModelOutputType = (typeof MODEL_OUTPUT_TYPES)[number];

export const MODEL_OUTPUT_TYPE_LABELS: Record<ModelOutputType, string> = {
  text: "文本",
  image: "图片",
  video: "视频",
};

/* ── 模型能力 ───────────────────────────────────────────────────── */

/* SAFETY: 类型断言已复核 */
export const MODEL_CAPABILITIES = [
  "structured-output",
  "native-web-search",
  "system-messages",
] as const;
export type ModelCapability = (typeof MODEL_CAPABILITIES)[number];

export const MODEL_CAPABILITY_LABELS: Record<ModelCapability, string> = {
  "structured-output": "结构化输出",
  "native-web-search": "原生联网搜索",
  "system-messages": "系统消息",
};

/* ── 推理等级 ───────────────────────────────────────────────────── */

/* SAFETY: 类型断言已复核 */
export const REASONING_LEVELS = ["low", "medium", "high"] as const;
export type ReasoningLevel = (typeof REASONING_LEVELS)[number];

/**
 * 推理参数映射：把「推理等级」翻成上游请求体里的一格。
 *
 * 形状 `{ param, values }`：
 *  · `param` 是请求体字段名（如 `reasoning_effort` / `thinking.budget_tokens`）；
 *  · `values` 是「等级 → 该字段取值」，取值按字符串存（数字也能被上游接受时
 *    由调用方自行转换；这里不做类型猜测，避免把 `"8192"` 与 `8192` 混成两种语义）。
 *
 * 只做配置与展示：当前运行时还没有「按次选推理等级」的入口，接入时由
 * `applyReasoningParam()` 统一读这一份，不在调用点各拼一份。
 */
export type ReasoningParamMapping = {
  param: string;
  values: Record<string, string>;
};

export function parseReasoningParamMapping(raw: unknown): ReasoningParamMapping | null {
  if (!isRecord(raw)) {
    return null;
  }
  const param = typeof raw.param === "string" ? raw.param.trim() : "";
  const values: Record<string, string> = {};
  const rawValues: unknown = raw.values;
  if (isRecord(rawValues)) {
    for (const [level, value] of Object.entries(rawValues)) {
      if (typeof value === "string" && level.trim() !== "") {
        values[level.trim()] = value.trim();
      }
    }
  }
  if (param === "" && Object.keys(values).length === 0) {
    return null;
  }
  return { param, values };
}

/* ── 词表容错解析（库里的坏值不该让整条模型消失）─────────────────── */

function pickKnown<T extends string>(raw: unknown, words: ReadonlyArray<T>): Array<T> {
  if (!Array.isArray(raw)) {
    return [];
  }
  const out: Array<T> = [];
  for (const item of raw) {
    if (typeof item !== "string") {
      continue;
    }
    const hit = words.find((word) => word === item);
    if (hit !== undefined && !out.includes(hit)) {
      out.push(hit);
    }
  }
  return out;
}

export function parseInputTypes(raw: unknown): Array<ModelInputType> {
  return pickKnown(raw, MODEL_INPUT_TYPES);
}

export function parseOutputTypes(raw: unknown): Array<ModelOutputType> {
  return pickKnown(raw, MODEL_OUTPUT_TYPES);
}

export function parseCapabilities(raw: unknown): Array<ModelCapability> {
  return pickKnown(raw, MODEL_CAPABILITIES);
}

/** 推理等级是用户可扩展的词表（各家叫法不同，如 `minimal` / `xhigh`），
 *  只做去空白与去重，不收窄到固定三档。 */
export function parseReasoningLevels(raw: unknown): Array<string> {
  if (!Array.isArray(raw)) {
    return [];
  }
  const out: Array<string> = [];
  for (const item of raw) {
    if (typeof item !== "string") {
      continue;
    }
    const level = item.trim();
    if (level !== "" && !out.includes(level)) {
      out.push(level);
    }
  }
  return out;
}

/* ── 智能配置：按模型名推断窗口 / 输出上限 / 输入类型 ─────────────── */

export type ModelSmartDefaults = {
  capabilities: Array<ModelCapability>;
  contextWindow: number | null;
  inputTypes: Array<ModelInputType>;
  maxOutputTokens: number | null;
};

type ModelFamilyRule = {
  capabilities?: Array<ModelCapability>;
  contextWindow: number;
  inputTypes: Array<ModelInputType>;
  /** 命中模型名的小写正则。 */
  match: RegExp;
  maxOutputTokens: number;
};

/* 规则表按「越具体越靠前」排列：先命中的那条生效。
 * 数字取各家公开文档的常见值（宁小勿大：填大了只会让上游拒绝，填小了才是真丢上下文）。 */
const MODEL_FAMILY_RULES: Array<ModelFamilyRule> = [
  {
    /* Agnes（apihub.agnes-ai.com）：文本模型 512K 窗口 / 65,536 输出，
     * 图像与视频模型同名前缀（agnes-image-* / agnes-video-*）。输入含图像
     * （官方文档：文本、图像 URL）。取值来自其模型卡公开数值（#3577）。 */
    match: /agnes/,
    contextWindow: 524_288,
    maxOutputTokens: 65_536,
    inputTypes: ["text", "image"],
    capabilities: ["structured-output", "system-messages"],
  },
  {
    match: /claude|anthropic/,
    contextWindow: 200_000,
    maxOutputTokens: 8192,
    inputTypes: ["text", "image", "pdf"],
    capabilities: ["structured-output", "system-messages"],
  },
  {
    match: /gemini/,
    contextWindow: 1_000_000,
    maxOutputTokens: 8192,
    inputTypes: ["text", "image", "video", "pdf"],
    capabilities: ["structured-output", "system-messages"],
  },
  {
    match: /(?<prefix>^|[/_-])o[134](?<suffix>-|$)|reasoning/,
    contextWindow: 200_000,
    maxOutputTokens: 100_000,
    inputTypes: ["text", "image"],
    capabilities: ["structured-output", "system-messages"],
  },
  {
    match: /gpt-5|gpt-4\.1/,
    contextWindow: 1_000_000,
    maxOutputTokens: 32_768,
    inputTypes: ["text", "image"],
    capabilities: ["structured-output", "system-messages"],
  },
  {
    match: /gpt-4o|gpt-4-turbo|gpt-4/,
    contextWindow: 128_000,
    maxOutputTokens: 16_384,
    inputTypes: ["text", "image"],
    capabilities: ["structured-output", "system-messages"],
  },
  {
    match: /deepseek/,
    contextWindow: 64_000,
    maxOutputTokens: 8192,
    inputTypes: ["text"],
    capabilities: ["structured-output", "system-messages"],
  },
  {
    match: /qwen|qwq/,
    contextWindow: 32_768,
    maxOutputTokens: 8192,
    inputTypes: ["text"],
    capabilities: ["structured-output", "system-messages"],
  },
  {
    match: /llama|mistral|mixtral/,
    contextWindow: 8192,
    maxOutputTokens: 4096,
    inputTypes: ["text"],
    capabilities: ["system-messages"],
  },
];

/** 兜底：认不出的模型给一组保守值（不会因为空窗口让下游算错预算）。 */
const FALLBACK_SMART_DEFAULTS: ModelSmartDefaults = {
  contextWindow: 8192,
  maxOutputTokens: 2048,
  inputTypes: ["text"],
  capabilities: ["system-messages"],
};

/** 兜底值 → 调用方独占的副本：两档数组都要复制，否则表单改一项会污染下一次推断。 */
function fallbackDefaults(): ModelSmartDefaults {
  return {
    ...FALLBACK_SMART_DEFAULTS,
    inputTypes: [...FALLBACK_SMART_DEFAULTS.inputTypes],
    capabilities: [...FALLBACK_SMART_DEFAULTS.capabilities],
  };
}

/** 按模型名推断一组默认值（「智能配置」打开时用来预填表单）。
 *  纯函数：只读入参，不读配置、不读网络。 */
export function inferModelDefaults(modelId: string): ModelSmartDefaults {
  const id = modelId.trim().toLowerCase();
  if (id === "") {
    return fallbackDefaults();
  }
  const rule = MODEL_FAMILY_RULES.find((candidate) => candidate.match.test(id));
  if (rule === undefined) {
    return fallbackDefaults();
  }
  return {
    contextWindow: rule.contextWindow,
    maxOutputTokens: rule.maxOutputTokens,
    inputTypes: [...rule.inputTypes],
    capabilities: [...(rule.capabilities ?? FALLBACK_SMART_DEFAULTS.capabilities)],
  };
}

/* ── 上下文窗口展示 ─────────────────────────────────────────────── */

/** 上下文窗口的展示格式：`200K` / `1M` / `8,192`（未知给 `EMPTY_PLACEHOLDER`）。
 *  设置页的行内摘要与表单提示共用它，别在两处各写一套除法。 */
export function formatContextWindow(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value) || value <= 0) {
    return EMPTY_PLACEHOLDER;
  }
  if (value >= 1_000_000) {
    return `${trimFixed(value / 1_000_000, 1) ?? String(value / 1_000_000)}M`;
  }
  if (value >= 1000) {
    return `${trimFixed(value / 1000, 1) ?? String(value / 1000)}K`;
  }
  return String(value);
}

/* ── 图像 / 视频模型的「接口端点」词表（#3656）───────────────────── */

/** 图像 / 视频模型的接口端点候选路径（动作路径**自带版本段**，#3656 新口径）：
 *  设置页「添加 / 编辑模型」弹窗按用途给成下拉，落库在 `remoteModel.endpointPath`。
 *  与文本协议三词表（`LLM_API_FORMAT_*`）刻意分开：图像 / 视频端点由**用途**决定，
 *  不吃 `chat-completions` 那套格式。运行时（工坊生图 / 生视频的目标解析）与
 *  设置页展示都从这里取默认值 —— 「没选 = 第一项」的唯一出处。 */
/* SAFETY: 类型断言已复核 */
export const REMOTE_MEDIA_ENDPOINT_OPTIONS = {
  image: ["/v1/images/generations"],
  video: ["/v1/videos"],
} as const;

export type MediaEndpointKind = keyof typeof REMOTE_MEDIA_ENDPOINT_OPTIONS;

export function isMediaEndpointKind(value: unknown): value is MediaEndpointKind {
  return value === "image" || value === "video";
}

/** 该用途的默认端点（下拉的第一项；库里没配 = 用它）。 */
export function defaultMediaEndpointPath(kind: MediaEndpointKind): string {
  return REMOTE_MEDIA_ENDPOINT_OPTIONS[kind][0];
}

/** 库里存的端点路径是否是「该用途认识的白名单值」。读侧收窄用：
 *  库里坏值（手改 / 旧数据）不报错，回落默认第一项。 */
export function isMediaEndpointPath(kind: MediaEndpointKind, value: unknown): boolean {
  const options: ReadonlyArray<string> = REMOTE_MEDIA_ENDPOINT_OPTIONS[kind];
  return typeof value === "string" && options.includes(value);
}

/** 生效的接口端点路径：候选拼在一起按顺序回落（模型自己的 → 默认第一项），
 *  与 `resolveApiFormat()` 同一形状。只服务图像 / 视频两种用途。 */
export function resolveMediaEndpointPath(
  kind: MediaEndpointKind,
  ...candidates: ReadonlyArray<unknown>
): string {
  for (const candidate of candidates) {
    if (typeof candidate === "string" && isMediaEndpointPath(kind, candidate)) {
      return candidate;
    }
  }
  return defaultMediaEndpointPath(kind);
}
