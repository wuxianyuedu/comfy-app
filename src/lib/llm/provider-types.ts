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

/** 上游接口协议格式。Base URL 由用户填写，路径段由格式决定：
 *  · `chat-completions` → `{base}/chat/completions`（OpenAI 兼容，最通用）
 *  · `anthropic-messages` → `{base}/v1/messages`（Anthropic Messages）
 *  · `responses` → `{base}/responses`（OpenAI Responses）
 *  刻意不在 Base URL 后自动补 `/v1`：各家网关的版本段位置不同（有的在域名后、
 *  有的在 `/api/v1`），替用户猜会造出「看着填对了却 404」的地址。设置页把最终
 *  请求地址直接显示出来，填错时用户当场能看见。 */
/* SAFETY: 类型断言已复核 */
export const LLM_API_FORMATS = ["chat-completions", "anthropic-messages", "responses"] as const;
export type LlmApiFormat = (typeof LLM_API_FORMATS)[number];

export const LLM_API_FORMAT_LABELS: Record<LlmApiFormat, string> = {
  "chat-completions": "Chat Completions（/chat/completions）",
  "anthropic-messages": "Anthropic Messages（/v1/messages）",
  responses: "Responses（/responses）",
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

/** 供应商最终请求地址（Base URL 去尾斜杠 + 格式路径）。空 Base URL 返回空串。 */
export function requestUrlForFormat(baseUrl: string, format: LlmApiFormat): string {
  const base = baseUrl.trim().replace(/\/$/, "");
  return base === "" ? "" : `${base}${LLM_API_FORMAT_PATHS[format]}`;
}

/** Base URL 看不出「接口版本段」时的提示（只提示、不改写，返回 `null` 表示不提示）。
 *
 *  版本段是路径最后一段 `v1` / `v1beta` / `v2` 这类（`/api/v1` 也算有）。
 *  两个例外不提示：格式路径**自带**版本段（Anthropic 的 `/v1/messages`，Base URL
 *  通常只到域名），以及 Base URL 还没填 / 不是合法 URL（那由字段校验管）。
 *
 *  为什么不自动补：各家网关版本段位置不同（有的在域名后、有的在 `/api/v1`），
 *  替用户猜会造出「看着填对了却 404」的地址（#3501 的既定口径，#3517 只加提示）。 */
export function baseUrlVersionHint(baseUrl: string, format: LlmApiFormat): string | null {
  if (/^\/v\d/i.test(LLM_API_FORMAT_PATHS[format])) {
    return null;
  }
  const trimmed = baseUrl.trim().replace(/\/+$/, "");
  if (trimmed === "") {
    return null;
  }
  let pathname: string;
  try {
    pathname = new URL(trimmed).pathname;
  } catch {
    return null;
  }
  const last = pathname.split("/").filter(Boolean).at(-1) ?? "";
  if (/^v\d+[a-z0-9]*$/i.test(last)) {
    return null;
  }
  return "看不出接口版本段（如 /v1）—— 有些网关要求 Base URL 带版本号，若测试连接报 404 请对照服务商文档补上";
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
