/**
 * `provider-form.ts` — 设置页「供应商 / 模型」表单的纯函数（#3501）。
 *
 * 三件事各只有一份实现：
 *   · **视图 → 表单**：库里的行 / 服务端视图填进受控输入（数字转字符串、JSON 列转词表）；
 *   · **表单 → 入参**：受控输入的字符串转回 `providerSave` / `modelSave` 的入参形状；
 *   · **字段级校验**：名称、Base URL、窗口 / 输出上限的规则（集合级重名在服务端唯一索引）。
 *
 * 不碰 React、不碰网络、不碰 tRPC 类型 —— 单测直接喂形状。
 *
 * @module lib/llm/provider-form
 */

import { isHttpUrl } from "~/lib/url-scheme";
import {
  inferModelDefaults,
  isLlmApiFormat,
  parseCapabilities,
  parseInputTypes,
  parseOutputTypes,
  parseReasoningLevels,
  parseReasoningParamMapping,
  type LlmApiFormat,
  type ModelCapability,
  type ModelInputType,
  type ModelOutputType,
} from "./provider-types";
import { inferOutputTypesFromName, REMOTE_MODEL_KINDS, type RemoteModelKind } from "./types";

/* ── 供应商 ─────────────────────────────────────────────────────── */

/** 供应商表单的受控值（`apiKey` 是本次输入的新值，不回填明文）。
 *  接口格式自 #3517 起是**模型级**配置，供应商这一层不再持有它。 */
export type ProviderFormValues = {
  apiKey: string;
  baseUrl: string;
  /** 编辑态显式清除已保存密钥（「留空不改」与「清空」是两件事）。 */
  clearApiKey: boolean;
  name: string;
};

export type ProviderFormSource = {
  baseUrl: string;
  hasApiKey: boolean;
  name: string;
};

export function emptyProviderForm(): ProviderFormValues {
  return { name: "", baseUrl: "", apiKey: "", clearApiKey: false };
}

export function providerFormFromView(source: ProviderFormSource): ProviderFormValues {
  return {
    name: source.name,
    baseUrl: source.baseUrl,
    apiKey: "",
    clearApiKey: false,
  };
}

export type ProviderFormErrors = Partial<Record<"baseUrl" | "name", string>>;

export function validateProviderForm(form: ProviderFormValues): ProviderFormErrors {
  const errors: ProviderFormErrors = {};
  if (form.name.trim() === "") {
    errors.name = "请填写供应商名称";
  }
  const baseUrl = form.baseUrl.trim();
  if (baseUrl === "") {
    errors.baseUrl = "请填写 Base URL";
  } else if (!isHttpUrl(baseUrl)) {
    errors.baseUrl = "Base URL 必须是 http/https 地址";
  }
  return errors;
}

export type ProviderSaveDraft = {
  /** 三态：非空串 = 写入；`null` = 显式清空；省略 = 保持既有。 */
  apiKey?: string | null;
  baseUrl: string;
  id?: string;
  name: string;
};

export function providerSaveDraft(form: ProviderFormValues, id?: string): ProviderSaveDraft {
  const typedKey = form.apiKey.trim();
  return {
    ...(id === undefined ? {} : { id }),
    name: form.name.trim(),
    baseUrl: form.baseUrl.trim().replace(/\/$/, ""),
    ...(typedKey === "" ? (form.clearApiKey ? { apiKey: null } : {}) : { apiKey: typedKey }),
  };
}

/* ── 模型 ───────────────────────────────────────────────────────── */

export type ModelFormValues = {
  /** 模型级接口格式（#3517）：同一供应商下文本 / 图片模型可能各用一套协议。 */
  apiFormat: LlmApiFormat;
  baseUrl: string;
  capabilities: Array<ModelCapability>;
  /** 数字字段用字符串存：空串 = 未填（`null`），输入中途不能被 Number("") 折成 0。 */
  contextWindow: string;
  enabled: boolean;
  inputTypes: Array<ModelInputType>;
  kind: RemoteModelKind;
  maxOutputTokens: string;
  name: string;
  /** 输出类型（#3577）：text / image / video。 */
  outputTypes: Array<ModelOutputType>;
  /** 推理等级（逗号 / 空格分隔的自由文本，各家叫法不同）。 */
  reasoningLevels: string;
  /** 推理参数映射：请求体字段名 + 「等级 → 取值」。 */
  reasoningParam: string;
  reasoningValues: Record<string, string>;
  smartConfig: boolean;
};

/** 服务端视图 / 库行的最小形状。JSON 列（能力 / 输入类型 / 推理等级）在
 *  drizzle 侧是 `unknown`，这里也收 `unknown` 交给 `parse*` 的容错解析 ——
 *  不在类型层假设「库里一定是干净数组」。 */
export type ModelFormSource = {
  apiFormat: string;
  baseUrl: string | null;
  capabilities: unknown;
  contextWindow: number | null;
  enabled: boolean;
  inputTypes: unknown;
  kind: string;
  maxOutputTokens: number | null;
  name: string;
  outputTypes: unknown;
  reasoningLevels: unknown;
  reasoningParamMapping: unknown;
  smartConfig: boolean;
};

function isRemoteModelKindValue(value: string): value is RemoteModelKind {
  const kinds: ReadonlyArray<string> = REMOTE_MODEL_KINDS;
  return kinds.includes(value);
}

/** 用途 → 默认输出类型（#3577）：文本模型出文本、图像模型出图、视频模型出视频。
 *  只做「未标注时的起点」，用户可在弹窗里改（多模态输出模型可多选）。 */
export function defaultOutputTypesForKind(kind: RemoteModelKind): Array<ModelOutputType> {
  if (kind === "image") {
    return ["image"];
  }
  if (kind === "video") {
    return ["video"];
  }
  return ["text"];
}

export function emptyModelForm(
  kind: RemoteModelKind = "chat",
  apiFormat: LlmApiFormat = "chat-completions",
): ModelFormValues {
  return {
    name: "",
    kind,
    apiFormat,
    smartConfig: true,
    contextWindow: "",
    maxOutputTokens: "",
    inputTypes: ["text"],
    outputTypes: defaultOutputTypesForKind(kind),
    capabilities: ["system-messages"],
    reasoningLevels: "",
    reasoningParam: "",
    reasoningValues: {},
    baseUrl: "",
    enabled: true,
  };
}

export function modelFormFromView(source: ModelFormSource): ModelFormValues {
  const mapping = parseReasoningParamMapping(source.reasoningParamMapping);
  const kindValue = isRemoteModelKindValue(source.kind) ? source.kind : "chat";
  return {
    name: source.name,
    kind: kindValue,
    apiFormat: isLlmApiFormat(source.apiFormat) ? source.apiFormat : "chat-completions",
    smartConfig: source.smartConfig,
    contextWindow:
      source.contextWindow === null || source.contextWindow === undefined
        ? ""
        : String(source.contextWindow),
    maxOutputTokens:
      source.maxOutputTokens === null || source.maxOutputTokens === undefined
        ? ""
        : String(source.maxOutputTokens),
    inputTypes: parseInputTypes(source.inputTypes),
    outputTypes: (() => {
      const parsed = parseOutputTypes(source.outputTypes);
      // 库里没标注（历史行）→ 按用途给起点，界面不留一排全空的开关。
      return parsed.length > 0 ? parsed : defaultOutputTypesForKind(kindValue);
    })(),
    capabilities: parseCapabilities(source.capabilities),
    reasoningLevels: parseReasoningLevels(source.reasoningLevels).join(", "),
    reasoningParam: mapping?.param ?? "",
    reasoningValues: mapping?.values ?? {},
    baseUrl: source.baseUrl ?? "",
    enabled: source.enabled,
  };
}

/**
 * 「智能配置」：按模型 id 推断窗口 / 输出上限 / 输入类型 / 能力。
 * 开关关掉时原样返回（用户手填的值不被覆盖）。
 */
export function applySmartDefaults(form: ModelFormValues): ModelFormValues {
  if (!form.smartConfig) {
    return form;
  }
  const defaults = inferModelDefaults(form.name);
  return {
    ...form,
    contextWindow: defaults.contextWindow === null ? "" : String(defaults.contextWindow),
    maxOutputTokens: defaults.maxOutputTokens === null ? "" : String(defaults.maxOutputTokens),
    inputTypes: [...defaults.inputTypes],
    /* 输出类型按模型名推断（名字带 video / image 的直接命中），推断不出来的
     * 时候按当前用途给起点 —— 用户改用途开关时输出跟着换一次底色。 */
    outputTypes: inferOutputTypesFromName(form.name),
    capabilities: [...defaults.capabilities],
  };
}

export type ModelFormErrors = Partial<Record<"contextWindow" | "maxOutputTokens" | "name", string>>;

/** 正整数（可空）：空串 = 未填；其余必须是大于 0 的整数。 */
function readPositiveInt(text: string): { error?: string; value: number | null } {
  const trimmed = text.trim();
  if (trimmed === "") {
    return { value: null };
  }
  const value = Number(trimmed);
  if (!Number.isInteger(value) || value <= 0) {
    return { value: null, error: "请填写大于 0 的整数" };
  }
  return { value };
}

export function validateModelForm(form: ModelFormValues): ModelFormErrors {
  const errors: ModelFormErrors = {};
  if (form.name.trim() === "") {
    errors.name = "请填写模型 ID";
  }
  const window = readPositiveInt(form.contextWindow);
  if (window.error !== undefined) {
    errors.contextWindow = window.error;
  }
  const output = readPositiveInt(form.maxOutputTokens);
  if (output.error !== undefined) {
    errors.maxOutputTokens = output.error;
  }
  return errors;
}

export type ModelSaveDraft = {
  /** 模型级接口格式（#3517）：写入时按白名单收窄，模型弹窗必填。 */
  apiFormat: LlmApiFormat;
  /** 模型级接口覆盖（历史行可能带；表单不改它，原样保留）。 */
  baseUrl: string | null;
  capabilities: Array<ModelCapability>;
  contextWindow: number | null;
  enabled: boolean;
  id?: string;
  inputTypes: Array<ModelInputType>;
  kind: RemoteModelKind;
  maxOutputTokens: number | null;
  name: string;
  outputTypes: Array<ModelOutputType>;
  providerId: string;
  reasoningLevels: Array<string>;
  reasoningParamMapping: { param: string; values: Record<string, string> } | null;
  smartConfig: boolean;
};

/** 推理等级自由文本 → 词表（逗号 / 中文逗号 / 空格 / 换行都算分隔符）。 */
export function splitReasoningLevels(text: string): Array<string> {
  return text
    .split(/[,，\s]+/)
    .map((part) => part.trim())
    .filter((part) => part !== "");
}

export function modelSaveDraft(
  form: ModelFormValues,
  ctx: { existingBaseUrl?: string | null; id?: string; providerId: string },
): ModelSaveDraft {
  return {
    ...(ctx.id === undefined ? {} : { id: ctx.id }),
    providerId: ctx.providerId,
    name: form.name.trim(),
    kind: form.kind,
    apiFormat: form.apiFormat,
    enabled: form.enabled,
    /* 表单不暴露模型级接口覆盖：编辑历史行时保留原值（清掉它等于把这条模型
     * 静默指向供应商，用户没做这个决定）。 */
    baseUrl: ctx.existingBaseUrl ?? null,
    contextWindow: readPositiveInt(form.contextWindow).value,
    maxOutputTokens: readPositiveInt(form.maxOutputTokens).value,
    inputTypes: form.inputTypes,
    outputTypes: form.outputTypes,
    capabilities: form.capabilities,
    reasoningLevels: splitReasoningLevels(form.reasoningLevels),
    reasoningParamMapping: parseReasoningParamMapping({
      param: form.reasoningParam,
      values: cleanReasoningValues(form.reasoningValues),
    }),
    smartConfig: form.smartConfig,
  };
}

/** 推理等级取值表的编辑：只留非空行（空值 = 该等级没有映射）。 */
export function cleanReasoningValues(raw: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [level, value] of Object.entries(raw)) {
    const key = level.trim();
    const text = value.trim();
    if (key !== "" && text !== "") {
      out[key] = text;
    }
  }
  return out;
}
