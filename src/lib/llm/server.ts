import { errorMessage } from "~/lib/error-message";

import "server-only";
import type { ZodType } from "zod";
import {
  llmConfigRepository,
  llmProviderRepository,
  remoteModelRepository,
} from "~/lib/core/repository";
import { OLLAMA_DEFAULT_BASE_URL } from "~/lib/endpoints";
import { asRecord } from "~/lib/is-record";
import { INLINE_SNIPPET_MAX, clampText } from "~/lib/text-clamp";
import type { LlmProvider, RemoteModel } from "~/server/db/schema";
import { extractStreamDelta, extractText, extractToolCalls, buildChatRequest } from "./api-format";
import {
  parseCapabilities,
  parseInputTypes,
  parseOutputTypes,
  parseReasoningLevels,
  parseReasoningParamMapping,
  resolveApiFormat,
  type LlmApiFormat,
} from "./provider-types";
import {
  resolveTaskTemperature,
  splitExtraModels,
  foldRemoteToLocal,
  isLoopbackBaseUrl,
  pickVisionModelName,
  REMOTE_MODEL_KINDS,
  TASK_TYPES,
} from "./types";
import type {
  LLMConfig,
  LLMMessage,
  LLMRequestOptions,
  LLMProviderType,
  RemoteModelEntry,
  RemoteModelKind,
  TaskType,
  LLMTool,
} from "./types";

const PROVIDER_TYPES: ReadonlyArray<LLMProviderType> = ["local", "remote"];

function isLLMProviderType(v: unknown): v is LLMProviderType {
  return typeof v === "string" && PROVIDER_TYPES.some((provider) => provider === v);
}

function isRemoteModelKind(v: unknown): v is RemoteModelKind {
  return typeof v === "string" && REMOTE_MODEL_KINDS.some((kind) => kind === v);
}

/** 只把「键都在任务白名单、值都是数字」的字典收窄成按任务温度覆盖表（空字典也合法）。 */
function isTaskTemperatureRecord(v: Record<string, unknown>): v is Record<TaskType, number> {
  return Object.entries(v).every(
    ([key, value]) => Object.hasOwn(TASK_TYPES, key) && typeof value === "number",
  );
}

/** 环境变量里的 provider 只认白名单：空串 / 非法值一律回落 local。 */
function providerFromEnv(v: string | undefined): LLMProviderType {
  return isLLMProviderType(v) ? v : "local";
}

const ENV_DEFAULTS: LLMConfig = {
  provider: providerFromEnv(process.env.LLM_PROVIDER),
  baseUrl: process.env.LLM_BASE_URL ?? OLLAMA_DEFAULT_BASE_URL,
  model: process.env.LLM_MODEL ?? "",
  extraModels: null,
  apiKey: process.env.LLM_API_KEY ?? null,
  temperature: Number(process.env.LLM_TEMPERATURE ?? 0.7),
  maxTokens: Number(process.env.LLM_MAX_TOKENS ?? 2048),
};

/** 一行远端模型 + 其供应商 → 运行期条目（连接参数优先取模型自己的，
 *  缺省回落到供应商；`apiFormat` 模型自己的优先，其次供应商默认，#3517）。 */
function entryFromRemoteRow(
  r: RemoteModel,
  providers: ReadonlyArray<LlmProvider>,
): RemoteModelEntry {
  const provider = r.providerId === null ? undefined : providers.find((p) => p.id === r.providerId);
  return {
    name: r.name,
    baseUrl: r.baseUrl ?? provider?.baseUrl ?? null,
    apiKey: r.apiKey ?? provider?.apiKey ?? null,
    // 用途只认白名单；库里的非法值归一成 null（历史上写坏一列不该让整条消失）。
    kind: isRemoteModelKind(r.kind) ? r.kind : null,
    providerId: r.providerId,
    apiFormat: resolveApiFormat(r.apiFormat, provider?.apiFormat),
    enabled: r.enabled,
    contextWindow: r.contextWindow,
    maxOutputTokens: r.maxOutputTokens,
    inputTypes: parseInputTypes(r.inputTypes),
    outputTypes: parseOutputTypes(r.outputTypes),
    capabilities: parseCapabilities(r.capabilities),
    reasoningLevels: parseReasoningLevels(r.reasoningLevels),
    reasoningParamMapping: parseReasoningParamMapping(r.reasoningParamMapping),
    smartConfig: r.smartConfig,
  };
}

/* 按层叠加出最终生效的 LLM 配置：
 *   1. process.env（作为默认值）
 *   2. 数据库里的单例行（用户在设置界面里的覆盖）
 *   3. 单次请求的覆盖（很少用；浏览器从不发送 apiKey）
 *
 * 温度解析优先级：override.taskType 的用户覆盖 → override.temperature →
 * 该任务类型的推荐默认（TASK_TYPES.defaultTemperature）→ DB.temperature（全局）
 *
 * 模型解析：override.model 命中 extraModels 里带独立 baseUrl / apiKey 的远端
 * 条目时，本次请求改走该条目的连接参数（未配置的继续用全局值）。
 */
export async function getLLMConfig(override?: LLMRequestOptions): Promise<LLMConfig> {
  const cfg: LLMConfig = { ...ENV_DEFAULTS };

  try {
    const row = await llmConfigRepository.findSingleton();
    if (row) {
      // DB 行按宽松对象视图读：json 列（extraModels / temperatureByTask）形状不保证，
      // 其余列由下方的白名单收窄。
      const rowRecord = asRecord(row);
      // 只接受白名单内的 provider；非法值保留 env 默认，下游按「非 remote 即本地」处理。
      if (isLLMProviderType(row.provider)) {
        cfg.provider = row.provider;
      }
      if (row.baseUrl) {
        cfg.baseUrl = row.baseUrl;
      }
      if (row.model) {
        cfg.model = row.model;
      }
      // 两类候选分开存：`llmConfig.extraModels` 是本地 ollama 候选（纯名字，无
      // apiKey），远端独立模型在 `remoteModel` 表。读取时合并两者，保证下游
      //（运行时按名找 baseUrl/apiKey、设置页候选清单、工坊分组）行为不变。
      const split = splitExtraModels(rowRecord?.extraModels);
      const remoteRows = await remoteModelRepository.list();
      const providerRows = await llmProviderRepository.list();
      const remoteEntries = remoteRows.map((r) => entryFromRemoteRow(r, providerRows));
      // 合并两来源：本地候选名 + 远端表条目。`split.remoteEntries` 在列里不该再
      // 出现（写入侧只落字符串），仍一并合并是因为**读侧不假设写入侧守规矩**——
      // 列里真混进对象时把它当远端条目读出来，总好过把整份候选清单判成畸形丢掉。
      cfg.extraModels = [
        ...split.localNames.map((n) => ({
          name: n,
          baseUrl: null,
          apiKey: null,
          /* SAFETY: 类型断言已复核 */
          kind: null as RemoteModelKind | null,
        })),
        ...remoteEntries,
        ...split.remoteEntries,
      ];
      if (typeof row.apiKey === "string" && row.apiKey !== "") {
        cfg.apiKey = row.apiKey;
      }
      if (row.temperature !== null && row.temperature !== undefined) {
        cfg.temperature = row.temperature;
      }
      // temperatureByTask 是 json 列，读出来是 unknown —— 形状由 resolveTaskTemperature 消费，
      // 只收「键在任务白名单、值是数字」的项，非法键丢弃。
      const taskTemperatures = asRecord(rowRecord?.temperatureByTask);
      if (taskTemperatures !== null && isTaskTemperatureRecord(taskTemperatures)) {
        cfg.temperatureByTask = taskTemperatures;
      }
      if (row.maxTokens !== null && row.maxTokens !== undefined) {
        cfg.maxTokens = row.maxTokens;
      }
    }
  } catch {
    // 数据库不可用 —— 回落到环境变量里的默认值
  }

  if (override) {
    if (override.provider) {
      cfg.provider = override.provider;
    }
    if (typeof override.baseUrl === "string" && override.baseUrl !== "") {
      cfg.baseUrl = override.baseUrl;
    }
    if (typeof override.model === "string" && override.model !== "") {
      cfg.model = override.model;
      // 工坊 / 设置页按名字切换模型：命中带独立连接参数的候选条目时改走该条目
      const entry = cfg.extraModels?.find(
        (e) => e.name === override.model && Boolean(e.baseUrl ?? e.apiKey),
      );
      if (entry) {
        if (typeof entry.baseUrl === "string" && entry.baseUrl !== "") {
          cfg.baseUrl = entry.baseUrl;
        }
        if (typeof entry.apiKey === "string" && entry.apiKey !== "") {
          cfg.apiKey = entry.apiKey;
        }
        if (entry.apiFormat !== null && entry.apiFormat !== undefined) {
          cfg.apiFormat = entry.apiFormat;
        }
      }
    }
    cfg.temperature = resolveTaskTemperature({
      taskType: override.taskType,
      explicitTemperature: override.temperature,
      overrides: cfg.temperatureByTask ?? null,
      fallback: cfg.temperature,
    });
    if (override.maxTokens !== null && override.maxTokens !== undefined) {
      cfg.maxTokens = override.maxTokens;
    }
  }

  return cfg;
}

/** 客户端可读写形状（configGet 出口）：
 *  extraModels 保持类型区分 —— 本地 ollama 候选为字符串、远端独立模型为条目对象，
 *  这样设置页保存时 configSave 能按「字符串 vs 对象」把它们各自写回正确的地方，
 *  不把本地候选误判成远端模型。
 */
export async function getConfigForClient() {
  const cfg = await getLLMConfig();
  // 重新从 DB 组装：本地候选(字符串) + 远端表条目(对象)，避免 getLLMConfig 的
  // 内部对象化丢失「本地/远端」的类型区分。
  const row = await llmConfigRepository.findSingleton();
  let extra: Array<string | RemoteModelEntry> = [];
  if (row) {
    const split = splitExtraModels(asRecord(row)?.extraModels);
    const remoteRows = await remoteModelRepository.list();
    const providerRows = await llmProviderRepository.list();
    /* 停用的模型不下发给客户端（工坊下拉 / 设置页都不该出现它）；历史遗留
     * （providerId 为空）的行照旧下发，迁移在供应商列表那一侧做。 */
    const tableEntries: Array<RemoteModelEntry> = remoteRows
      .filter((r) => r.enabled)
      .map((r) => entryFromRemoteRow(r, providerRows));
    // 读取层兜底归并：`remoteModel` 表里若存着指向本机回环、且不带 apiKey 的条目，
    // 那是「本地 ollama 被错存成了远端」，折回本地候选字符串下发 —— 工坊下拉与设置页
    // 因此不会再把它挂「远端」小标。
    const folded = foldRemoteToLocal(
      [...tableEntries, ...split.remoteEntries],
      split.localNames,
      row.baseUrl,
    );
    extra = [...folded.localNames, ...folded.remoteEntries];
  }
  const cfgSafe: LLMConfig = { ...cfg };
  delete cfgSafe.apiKey;
  const extraSafe = extra.map((e) =>
    typeof e === "object" && e !== null ? maskRemoteEntryForClient(e) : e,
  );
  return {
    ...cfgSafe,
    hasApiKey: Boolean(cfg.apiKey),
    apiKey: undefined,
    extraModels: extraSafe,
  };
}

/** 下发给客户端的远端条目：明文密钥一律剥掉（台账 A4），但**留下「这条存过密钥」**。
 *
 * 那半个信息不是锦上添花：客户端拿不到密钥，就分不清「这条从来没配过」与
 * 「这条配过、这次用户没重填」，而设置页保存是「整份清单覆盖」（`replaceAll`）——
 * 于是「没带」被读成「清空」，密钥隔一次保存就没（台账 A11）。
 * 有了 `hasApiKey`，回写时未重填的条目就**省略** `apiKey` 键，而不是填 `null`。
 *
 * #3501 起远端模型的窗口 / 能力 / 推理参数由供应商页（`providersGet`）维护，
 * 这里只保留工坊下拉需要的身份与连接信息（外加 `providerId` 供分组），
 * 不再把内部配置整包发给浏览器。 */
function maskRemoteEntryForClient(e: RemoteModelEntry): RemoteModelEntry {
  const { apiKey, ...rest } = e;
  return {
    name: rest.name,
    baseUrl: rest.baseUrl ?? null,
    kind: rest.kind ?? null,
    providerId: rest.providerId ?? null,
    hasApiKey: Boolean(apiKey) || rest.hasApiKey === true,
  };
}

/** 把 Node fetch 的网络层 TypeError（如 `fetch failed`）翻译成可操作的人话。
 *  历史 bug：Ollama 未启动 / 远端不可达时，用户只看到一句 `fetch failed`，
 *  既不知道是连不上本地 Ollama 还是远端 Key 无效，也没提示怎么处理。 */
export function describeFetchFailure(e: unknown, cfg: LLMConfig): string {
  /* 非 TypeError（未预期的抛值形态）：与全库同一个取值出口，
   * 免得 `String(e)` 那一路把非 Error 抛值渲染成 `[object Object]`。 */
  if (!(e instanceof TypeError)) {
    return errorMessage(e, "网络请求失败");
  }
  // 运行期取 `cause`（Node 的 fetch TypeError 会挂它），按 unknown 处理。
  const cause: unknown = Reflect.get(e, "cause");
  const causeMsg =
    cause instanceof Error
      ? String(cause.message)
      : cause === null || cause === undefined
        ? ""
        : typeof cause === "string"
          ? cause
          : (JSON.stringify(cause) ?? "");
  const base = cfg.baseUrl.replace(/\/$/, "");
  const local = cfg.provider === "local" || isLoopbackBaseUrl(base);
  // 常见 Node undici 底层错误码
  if (/ECONNREFUSED|ECONNRESET/.test(causeMsg)) {
    return local
      ? `连不上本地服务（${base}）：连接被拒绝。请确认本地 ${cfg.model ? "Ollama/LM Studio" : "模型服务"} 已启动，或检查 Base URL 端口是否正确。`
      : `连不上远端服务（${base}）：连接被拒绝。请检查网络、Base URL 是否正确，或服务是否在运行。`;
  }
  if (/ENOTFOUND|getaddrinfo|DNS|EAI_AGAIN/.test(causeMsg)) {
    return `域名解析失败（${base}）：地址不存在或网络未连通，请检查 Base URL 与网络。`;
  }
  if (/ETIMEDOUT|timeout|timed out/i.test(causeMsg)) {
    return `连接超时（${base}）：服务无响应。本地请确认 Ollama 已启动；远端请检查网络与接口可达性。`;
  }
  if (local) {
    return `调用本地模型失败（${base}）：${causeMsg || "无法连接"}。请确认本地 Ollama/LM Studio 已启动且已拉取模型 ${cfg.model || ""}。`;
  }
  return `调用远端模型失败（${base}）：${causeMsg || errorMessage(e, "未知错误")}。请检查 Base URL / API Key / 网络。`;
}

/**
 * 取「视觉评审」生效配置（P8-2）：模型名走 `pickVisionModelName`（显式指定 → 候选里
 * kind=image 那条 → 主 model），并按名字回查远端条目的连接参数（baseUrl / apiKey / 格式）。
 * 未单独配视觉模型时回落主 model，连接参数沿用主配置。
 */
export async function getVisionLLMConfig(override?: LLMRequestOptions): Promise<LLMConfig> {
  const cfg = await getLLMConfig(override);
  const visionModel = pickVisionModelName(cfg, override);
  if (visionModel === cfg.model) {
    return cfg;
  }
  const entry = cfg.extraModels?.find(
    (e) => e.name === visionModel && Boolean(e.baseUrl ?? e.apiKey),
  );
  return {
    ...cfg,
    model: visionModel,
    ...(entry
      ? {
          baseUrl: entry.baseUrl ?? cfg.baseUrl,
          apiKey: entry.apiKey ?? cfg.apiKey,
          ...(entry.apiFormat !== null && entry.apiFormat !== undefined
            ? { apiFormat: entry.apiFormat }
            : {}),
        }
      : {}),
  };
}

/** 生效的接口格式：缺省按 OpenAI 兼容（历史行为）。 */
function formatOf(cfg: LLMConfig): LlmApiFormat {
  return cfg.apiFormat ?? "chat-completions";
}

type ChatCallOptions = {
  responseFormatJson?: boolean;
  stream: boolean;
  tools?: Array<LLMTool>;
};

/** 统一的上游对话请求（三种格式的 url / headers / body 由 `./api-format` 组装）：
 *  网络层失败给出可读原因，HTTP 非 2xx 带状态码与响应片段。 */
async function upstreamChat(
  cfg: LLMConfig,
  messages: Array<LLMMessage>,
  options: ChatCallOptions,
): Promise<Response> {
  const request = buildChatRequest({
    format: formatOf(cfg),
    baseUrl: cfg.baseUrl,
    /* 本地 Ollama 从不需要鉴权头（历史行为）：全局 provider=local 时即便配了
     * `apiKey` 也不往外发 —— 那是给远端用的密钥，不该落到本机回环请求上。 */
    apiKey: cfg.provider === "local" ? null : cfg.apiKey,
    model: cfg.model,
    messages,
    temperature: cfg.temperature,
    maxTokens: cfg.maxTokens,
    stream: options.stream,
    tools: options.tools,
    responseFormatJson: options.responseFormatJson,
    local: cfg.provider === "local",
  });
  let res: Response;
  try {
    res = await fetch(request.url, {
      method: "POST",
      headers: request.headers,
      body: JSON.stringify(request.body),
    });
  } catch (error) {
    throw new Error(describeFetchFailure(error, cfg), { cause: error });
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    // 401/403 大概率是 Key 无效 / 未授权 —— 给个更明确的提示，而不是只给状态码。
    const hint =
      res.status === 401 || res.status === 403 ? "（API Key 无效或未授权，请检查后重试）" : "";
    const snippet = detail.trim()
      ? `：${clampText(detail, { maxLength: INLINE_SNIPPET_MAX, marker: "" })}`
      : "";
    throw new Error(`LLM 请求失败 (${res.status})${hint}${snippet}`);
  }
  return res;
}

/** 模型未配置（空）时给调用方的统一出口文案 —— 不再兜底默认模型，
 *  避免用空的 model 打到后端拿一个「model not found」的含糊错误。 */
const ERR_MODEL_UNCONFIGURED =
  "尚未配置生效模型：请先在「设置 → 本地模型/远程模型」中选择或填写要使用的模型名";

function assertModelConfigured(cfg: LLMConfig): void {
  if (!cfg.model.trim()) {
    throw new Error(ERR_MODEL_UNCONFIGURED);
  }
}

/* 一次性（非流式）补全。 */
export async function completeLLM(cfg: LLMConfig, messages: Array<LLMMessage>): Promise<string> {
  assertModelConfigured(cfg);
  const res = await upstreamChat(cfg, messages, { stream: false });
  const json: unknown = await res.json();
  return extractText(formatOf(cfg), json);
}

/* 流式补全。每收到一个增量就调用一次 `onToken`，最终以「拼接好的完整文本」resolve。
 * SSE 分片形状按格式分派（chat-completions 的 `choices[0].delta.content`、
 * Anthropic 的 `content_block_delta`、Responses 的 `response.output_text.delta`）。
 */
export async function streamLLM(
  cfg: LLMConfig,
  messages: Array<LLMMessage>,
  onToken: (token: string) => void,
): Promise<string> {
  assertModelConfigured(cfg);
  const format = formatOf(cfg);
  const res = await upstreamChat(cfg, messages, { stream: true });
  if (!res.body) {
    throw new Error("LLM 服务未返回数据流，请重试");
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let full = "";

  while (true) {
    // oxlint-disable-next-line no-await-in-loop -- 顺序依赖：后一步要用前一步的结果（既有串行路径）
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) {
        continue;
      }
      const data = trimmed.slice(5).trim();
      if (data === "[DONE]") {
        continue;
      }
      try {
        const token = extractStreamDelta(format, JSON.parse(data));
        if (token) {
          full += token;
          onToken(token);
        }
      } catch {
        // 忽略格式不对的保活分片
      }
    }
  }

  return full;
}

/**
 * 结构化（JSON）补全：强制 JSON 输出并用 Zod schema 校验，
 * 端到端类型安全，避免手写 JSON.parse + 类型断言导致解析失败。
 */
export async function completeLLMStructured<T>(
  cfg: LLMConfig,
  messages: Array<LLMMessage>,
  schema: ZodType<T>,
): Promise<T> {
  assertModelConfigured(cfg);
  const res = await upstreamChat(cfg, messages, { stream: false, responseFormatJson: true });

  const json: unknown = await res.json();
  const content = extractText(formatOf(cfg), json) || "{}";
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error("LLM 返回非 JSON，无法解析结构化结果");
  }
  return schema.parse(parsed);
}

/**
 * Tools 协议补全：调用带 tools 的 /chat/completions 并返回完整的
 * assistant message（可能含 tool_calls 或纯文本 content）。
 * 兼容 OpenAI / Ollama / LM Studio / vLLM —— 它们都实现 OpenAI 的
 * `tools` 参数与 tool_calls 回包结构。
 *
 * 供应商选了 `anthropic-messages` / `responses` 时**大声拒绝**：这两条协议的
 * 工具定义与回包形状各不相同，仓里当前没有使用方，发一个半套的 tools 只会
 * 让上游静默忽略、再以「模型不听话」的形态暴露。
 */
export type CompleteToolsResult = {
  content: string;
  toolCalls: Array<{
    function: { arguments: string; name: string };
    id: string;
    type: "function";
  }>;
};

export async function completeLLMTools(
  cfg: LLMConfig,
  messages: Array<LLMMessage>,
  tools: Array<LLMTool>,
): Promise<CompleteToolsResult> {
  assertModelConfigured(cfg);
  const format = formatOf(cfg);
  if (format !== "chat-completions") {
    throw new Error(
      `当前供应商的接口格式（${format}）暂不支持工具调用：请在供应商设置里改用 Chat Completions 格式`,
    );
  }
  const res = await upstreamChat(cfg, messages, { stream: false, tools });
  const json: unknown = await res.json();
  return { content: extractText(format, json), toolCalls: extractToolCalls(format, json) };
}
