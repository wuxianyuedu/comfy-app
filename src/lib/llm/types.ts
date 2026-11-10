// ── 共享的 LLM 类型 ─────────────────────────────────────
// 本地（Ollama / LM Studio / vLLM）与远程（OpenAI 兼容）两类提供商，
// 都讲 OpenAI 的 /v1/chat/completions 协议。

import { isRecord } from "~/lib/is-record";
import type { LlmApiFormat } from "./provider-types";

export type LLMProviderType = "local" | "remote";

/** 已知的任务类型 key —— 用于按场景选择不同温度。
 *  `defaultTemperature` 是该任务类型未配置覆盖时的推荐默认值（取 hint 区间中位），
 *  不再一律回落到全局 0.7。 */
/* SAFETY: 类型断言已复核 */
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
  review: {
    label: "内容评审",
    desc: "低温稳定，判定与评分可复现",
    hint: "0.05~0.2",
    defaultTemperature: 0.1,
  },
} as const;

export type TaskType = keyof typeof TASK_TYPES;

/** 远端模型的用途：对话（语言模型）/ 图片 / 视频。当前仅对话参与运行时，
 *  图片 / 视频模型先落配置，供后续远程生图 / 生视频接入。 */
/* SAFETY: 类型断言已复核 */
export const REMOTE_MODEL_KINDS = ["chat", "image", "video"] as const;
export type RemoteModelKind = (typeof REMOTE_MODEL_KINDS)[number];
export const REMOTE_MODEL_KIND_LABELS: Record<RemoteModelKind, string> = {
  chat: "对话",
  image: "图片",
  video: "视频",
};

/** 远端候选模型条目。
 *
 * `apiKey` 是**三态**的，不是「有值 / 没值」两态（台账 A11 的成因就是把三态压成了两态）：
 *   · 非空字符串 —— 用户这次填了新密钥，写进去；
 *   · `null`（或空串 / 全空白）—— 用户**显式清空**，写 `null`；
 *   · 缺键 / `undefined` —— 本次不提供意见：这条值来自服务端下发（那边出于脱敏
 *     根本不带密钥，见 `getConfigForClient`），原样回写不等于「用户想把它清掉」。
 * 之所以必须由调用点**省略这个键**而不是填 `null`：设置页每次保存都是「把当前清单
 * 整份覆盖」（`remoteModelRepository.replaceAll`），两态写法会让「没动过」被读成
 * 「清空」，填过的密钥隔一次保存就没。
 *
 * `hasApiKey` 是**只读视图字段**：服务端下发时逐条标「这条存过密钥」（与顶层同口径），
 * 供设置页显示「已配置」而不把明文送进浏览器；它不参与写入判定。 */
export type RemoteModelEntry = {
  /** 所属供应商的接口格式（#3501；服务端按它组装请求）。 */
  apiFormat?: LlmApiFormat | null;
  apiKey?: string | null;
  baseUrl?: string | null;
  /** 模型能力（#3501）：structured-output / native-web-search / system-messages。 */
  capabilities?: Array<string> | null;
  /** 上下文窗口（token，#3501）。 */
  contextWindow?: number | null;
  /** 是否启用（#3501；停用的模型不下发给工坊下拉）。 */
  enabled?: boolean;
  hasApiKey?: boolean;
  /** 输入类型（#3501）：text / image / video / pdf。 */
  inputTypes?: Array<string> | null;
  kind?: RemoteModelKind | null;
  /** 最大输出 token（#3501）。 */
  maxOutputTokens?: number | null;
  name: string;
  /** 所属供应商 id（#3501）；空 = 历史遗留条目。 */
  providerId?: string | null;
  /** 推理等级词表（#3501）。 */
  reasoningLevels?: Array<string> | null;
  /** 推理参数映射（#3501）：{ param, values }。 */
  reasoningParamMapping?: unknown;
  /** 「智能配置」开关（#3501）。 */
  smartConfig?: boolean;
};

/** `apiKey` 的三态归一（唯一一份口径，`normalizeExtraModels` 与 `splitExtraModels`
 *  都吃它 —— 这两处此前各写一份「不是非空字符串就折成 null」，而那正是把
 *  「服务端下发的脱敏条目」读成「用户要清空密钥」的地方）。
 *  非空串 → 去空白后的值；`null` / 空串 / 全空白 → `null`（显式清空）；
 *  缺键 / `undefined` / 其它类型 → `undefined`（不提供意见，保留库里既有）。 */
export function normalizeEntryApiKey(rec: Record<string, unknown>): string | null | undefined {
  const v: unknown = rec.apiKey;
  if (typeof v === "string") {
    return v.trim() === "" ? null : v.trim();
  }
  if (v === null) {
    return null;
  }
  return undefined;
}

/** extraModels 的原始存储 / 传输形状：旧数据是纯名字字符串，新数据是条目对象。 */
export type RawExtraModel = string | RemoteModelEntry;

/** 运行期白名单判定：词表里有的字符串才收窄成 `RemoteModelKind`。 */
function isRemoteModelKind(value: unknown): value is RemoteModelKind {
  const kinds: ReadonlyArray<string> = REMOTE_MODEL_KINDS;
  return typeof value === "string" && kinds.includes(value);
}

/**
 * 列表里**一枚对象**的容错归一（`normalizeExtraModels` 与 `splitExtraModels` 共用）。
 *
 * 这两处过去各写一遍同样的四步（名字 trim / 无名丢弃 / 接口空白折 `null` / 密钥三态 /
 * 用途白名单），只差「去重」那一半 —— 于是给条目加一个字段时，改一处、漏一处，
 * 而两处的失效形态还不一样（读出来少一列 vs 保存时静默不落）。抽成一处之后，
 * 「读边界认哪些键」这件事在库里只有一个答案。
 *
 * 它与 `~/lib/llm/remote-model-schema` 的 `remoteModelEntrySchema` **刻意是两个角色**：
 * 那份判「这条请求能不能收下」（认不出的用途直接拒），这一份判「库里那一行读出来是什么」
 * （认不出的用途落 `null`、整条留着 —— 历史上写坏一列不该让模型从列表里消失）。
 * 两者对**同一枚合法条目**必须给出同样的字段，那一件事有判据：
 * `tests/remote-model-entry-wire-contract.test.ts` 的「读边界与入参判据对同一枚合法条目同读数」。
 *
 * 返回 `null` = 这一枚不是条目（不是对象、没有名字、名字全空白）。
 */
function normalizeExtraModelItem(item: unknown): RemoteModelEntry | null {
  if (!isRecord(item)) {
    return null;
  }
  const rec = item;
  const name = typeof rec.name === "string" ? rec.name.trim() : "";
  if (name === "") {
    return null;
  }
  const kind: unknown = rec.kind;
  const apiKey = normalizeEntryApiKey(rec);
  return {
    name,
    baseUrl: typeof rec.baseUrl === "string" && rec.baseUrl.trim() !== "" ? rec.baseUrl : null,
    // 三态：`undefined` 时**不挂这个键**（「不提供意见」不能被写成「清空」）
    ...(apiKey === undefined ? {} : { apiKey }),
    kind: isRemoteModelKind(kind) ? kind : null,
  };
}

/** 把 DB / 请求载荷里的 extraModels 归一化成条目数组（丢弃无名与空白项）。 */
export function normalizeExtraModels(raw: unknown): Array<RemoteModelEntry> {
  if (!Array.isArray(raw)) {
    return [];
  }
  const out: Array<RemoteModelEntry> = [];
  for (const item of raw) {
    if (typeof item === "string") {
      // 字符串形态只带了名字，对连接参数**不提供意见**（挂 null 会被读成「清空」）
      if (item.trim() !== "") {
        out.push({ name: item, baseUrl: null, kind: null });
      }
      continue;
    }
    const entry = normalizeExtraModelItem(item);
    if (entry) {
      out.push(entry);
    }
  }
  return out;
}

/** 取候选模型的名字（兼容旧字符串与新条目两种形状）。 */
export function extraModelName(entry: RawExtraModel): string {
  return typeof entry === "string" ? entry : entry.name;
}

/** option C 的拆分结果：本地 ollama 候选（纯名字，无 apiKey）与远端独立模型分开。 */
export type ExtraModelSplit = {
  /** 本地 Ollama 候选模型名（无 apiKey）。 */
  localNames: Array<string>;
  /** 远端独立模型条目（可带独立 baseUrl / apiKey）。 */
  remoteEntries: Array<RemoteModelEntry>;
};

/**
 * 把 DB / 请求里的候选列表按「类型」拆成本地与远端两堆：
 *   字符串 → 本地候选名；对象 → 远端条目。
 * 用于设置页保存时的写入分派与工坊分组下拉的静态来源。
 */
export function splitExtraModels(raw: unknown): ExtraModelSplit {
  const localNames: Array<string> = [];
  const remoteEntries: Array<RemoteModelEntry> = [];
  if (!Array.isArray(raw)) {
    return { localNames, remoteEntries };
  }
  for (const item of raw) {
    if (typeof item === "string") {
      const n = item.trim();
      if (n !== "" && !localNames.includes(n)) {
        localNames.push(n);
      }
      continue;
    }
    /* 对象那一支的归一与读取侧同一次实现（见 `normalizeExtraModelItem`）——
     * 这里多出来的只有「按名字去重」与「字符串归本地候选」这两条分派规则。 */
    const entry = normalizeExtraModelItem(item);
    if (!entry || remoteEntries.some((e) => e.name === entry.name)) {
      continue;
    }
    remoteEntries.push(entry);
  }
  return { localNames, remoteEntries };
}

/**
 * 判断目标服务是否为本地回环（localhost / 127.x / [::1]）—— 本地 Ollama 等
 * 回环服务；真远端模型不会用回环地址访问。与服务端 describeFetchFailure 的判定一致。
 */
export function isLoopbackBaseUrl(url: unknown): boolean {
  const value = typeof url === "string" ? url : "";
  return /^(?:https?:\/\/)?(?:localhost|127\.|\[::1\])/i.test(value.trim());
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
  if (e.apiKey !== undefined && e.apiKey !== null && e.apiKey !== "") {
    return false;
  } // 带独立密钥 = 真远端
  const effective =
    e.baseUrl !== undefined && e.baseUrl !== null && e.baseUrl.trim() !== ""
      ? e.baseUrl
      : (llmBaseUrl ?? "");
  return isLoopbackBaseUrl(effective);
}

/** 把「远端条目堆 + 本地候选名」按上面判定归并成本/远端两组：
 *  误存的本地 ollama 折回本地候选名，真远端条目保留。调用点据此重建下发给客户端的
 *  候选清单（字符串=本地、对象=远端），也让设置页保存时能把误存条目顺带清出远端表。 */
export function foldRemoteToLocal(
  remoteEntries: Array<RemoteModelEntry>,
  localNames: Array<string>,
  llmBaseUrl: string | null | undefined,
): ExtraModelSplit {
  const locals = [...localNames];
  const remotes: Array<RemoteModelEntry> = [];
  for (const e of remoteEntries) {
    if (isMisplacedLocalOllama(e, llmBaseUrl)) {
      if (!locals.includes(e.name)) {
        locals.push(e.name);
      }
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
  explicitTemperature?: number | null;
  fallback: number;
  overrides?: Partial<Record<TaskType, number>> | null;
  taskType?: TaskType;
}): number {
  const { taskType, explicitTemperature, overrides, fallback } = opts;
  if (taskType && overrides?.[taskType] !== null && overrides?.[taskType] !== undefined) {
    return overrides[taskType];
  }
  if (explicitTemperature !== null && explicitTemperature !== undefined) {
    return explicitTemperature;
  }
  if (taskType) {
    return TASK_TYPES[taskType].defaultTemperature;
  }
  return fallback;
}

export type LLMConfig = {
  /** 上游接口格式（#3501）：由命中的供应商决定，缺省按 OpenAI 兼容处理。 */
  apiFormat?: LlmApiFormat;
  /** remote 提供方的密钥；与 RemoteModelEntry.apiKey 一样只在服务端参与请求 */
  apiKey?: string | null;
  /** OpenAI-compatible base URL: 本机 Ollama 默认值见 `~/lib/endpoints`
   *  （`OLLAMA_DEFAULT_BASE_URL`），也可以指向任意远端 `https://…/v1`。 */
  baseUrl: string;
  /** 候选模型（设置页可配置多个）：本地 Ollama 为纯名字；远端条目可带独立 baseUrl / apiKey */
  extraModels?: Array<RemoteModelEntry> | null;
  maxTokens: number;
  model: string;
  provider: LLMProviderType;
  /** 全局默认温度（未区分任务类型的调用的 fallback） */
  temperature: number;
  /** 按任务类型覆盖的温度；缺失某 key 时回退到该任务的推荐默认值 */
  temperatureByTask?: Record<TaskType, number> | null;
};

/* 发送给浏览器 / 与浏览器共享的配置形状（apiKey 已脱敏）。 */
export type LLMConfigView = {
  baseUrl: string;
  /** 候选模型名（条目已归一成名字下发，供工坊内切换；连接参数不下发） */
  extraModels?: Array<string> | null;
  hasApiKey: boolean;
  maxTokens: number;
  model: string;
  provider: LLMProviderType;
  temperature: number;
  temperatureByTask?: Record<TaskType, number> | null;
};

/**
 * 多模态消息内容块（P8-2 视觉评审地基）：文本块 + 图块。OpenAI 兼容接口用 content
 * 数组表达（`{type:"text"}` + `{type:"image_url"}`），Ollama 把图收进消息的 `images`
 * 字段（`messagesToWire` 按 provider 分派，见 `~/lib/llm/server`）。`url` 接受 http(s)
 * 与 `data:` base64；本地 Ollama 可直接喂 `http://localhost:…` 的图，远端模型喂公网可达址。
 */
export type LLMContentPart =
  | { text: string; type: "text" }
  | { image_url: { url: string }; type: "image_url" };

export type LLMMessage = {
  /** 纯文本（历史用法）或多模态内容块数组（带图时用）。两者都合法。 */
  content: string | Array<LLMContentPart>;
  role: "system" | "user" | "assistant" | "tool";
  /** 仅 role === "tool" 时需要：标识对应哪个 tool_call。 */
  tool_call_id?: string;
  /** 仅 role === "assistant" 时可能出现：携带 tool_calls 的消息回灌。 */
  tool_calls?: Array<{
    function: { arguments: string; name: string };
    id: string;
    type: "function";
  }>;
};
/** OpenAI function calling 工具定义（OpenAI 兼容 /chat/completions 的 tools 参数）。 */
export type LLMTool = {
  function: {
    description: string;
    name: string;
    parameters?: Record<string, unknown>;
  };
  type: "function";
};

/** OpenAI 兼容响应中的 tool_call 条目。 */
export type LLMToolCall = {
  function: {
    arguments: string;
    name: string;
  };
  id: string;
  type: "function";
};

/** 工坊阶段的 key —— 供按阶段挑选模型 / 提示各阶段能力 */
/* SAFETY: 类型断言已复核 */
export const WORKSHOP_STAGES = [
  { id: "script", label: "剧本" },
  { id: "character", label: "角色卡" },
  { id: "storyboard", label: "分镜" },
  { id: "prompt", label: "图片提示词" },
] as const;

export type WorkshopStage = (typeof WORKSHOP_STAGES)[number]["id"];

export type LLMRequestOptions = {
  baseUrl?: string;
  maxTokens?: number;
  model?: string;
  provider?: LLMProviderType;
  /** 调用方指定的任务类型，用于查找 temperatureByTask 覆盖 */
  taskType?: TaskType;
  temperature?: number;
  /** OpenAI 兼容 function calling 的工具列表（可选，Agent 指挥用）。 */
  tools?: Array<LLMTool>;
  /**
   * 视觉评审专用模型（P8-2）：不传时回落到「远端候选里 kind=image 的那条」或主 `model`。
   * 多模态评审需要的模型往往与文本对话模型不同（如 Ollama 的 llava / 远端 gpt-4o），
   * 因此给它一个独立指定通道，缺省不强行要求用户配置。
   */
  visionModel?: string;
};

/**
 * 选视觉评审模型名（P8-2）：优先级 = 调用方显式指定 → 远端候选里 `kind=image` 的那条
 * → 主 `model`（未单独配视觉模型时，同一模型既出文也出图，Ollama 多模态模型即此形态）。
 * 仅挑名字；连接参数（baseUrl / apiKey）由 `getVisionLLMConfig` 按名字回查远端条目补。
 */
export function pickVisionModelName(
  cfg: LLMConfig,
  override?: { visionModel?: string | null },
): string {
  const explicit = override?.visionModel?.trim();
  if (explicit !== undefined && explicit !== "") {
    return explicit;
  }
  const imageEntry = cfg.extraModels?.find((e) => e.kind === "image");
  if (imageEntry) {
    return imageEntry.name;
  }
  return cfg.model;
}
