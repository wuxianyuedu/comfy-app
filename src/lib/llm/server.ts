import { errorMessage } from "~/lib/error-message";

import "server-only";
import type { ZodType } from "zod";
import {
  llmConfigRepository,
  remoteModelRepository,
} from "~/lib/core/repository";
import { OLLAMA_DEFAULT_BASE_URL } from "~/lib/endpoints";
import {
  resolveTaskTemperature,
  splitExtraModels,
  foldRemoteToLocal,
  isLoopbackBaseUrl,
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

const ENV_DEFAULTS: LLMConfig = {
  provider: (process.env.LLM_PROVIDER as LLMProviderType) || "local",
  baseUrl: process.env.LLM_BASE_URL ?? OLLAMA_DEFAULT_BASE_URL,
  model: process.env.LLM_MODEL ?? "",
  extraModels: null,
  apiKey: process.env.LLM_API_KEY ?? null,
  temperature: Number(process.env.LLM_TEMPERATURE ?? 0.7),
  maxTokens: Number(process.env.LLM_MAX_TOKENS ?? 2048),
};

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
export async function getLLMConfig(
  override?: LLMRequestOptions,
): Promise<LLMConfig> {
  const cfg: LLMConfig = { ...ENV_DEFAULTS };

  try {
    const row = await llmConfigRepository.findSingleton();
    if (row) {
      if (row.provider) cfg.provider = row.provider as LLMProviderType;
      if (row.baseUrl) cfg.baseUrl = row.baseUrl;
      if (row.model) cfg.model = row.model;
      // option C：llmConfig.extraModels 只存本地 ollama 候选（纯名字，无 apiKey）；
      // 远端独立模型改存 remoteModel 表。读取时合并两者，保证下游（运行时按名
      // 找 baseUrl/apiKey、设置页候选清单、工坊分组）行为不变。
      // 直接吃 DB 原始值（llmConfig.extraModels 里字符串=本地候选，对象=遗留/远端）
      const split = splitExtraModels(
        (row as Record<string, unknown>).extraModels,
      );
      const remoteRows = await remoteModelRepository.list();
      const remoteEntries = remoteRows.map((r) => ({
        name: r.name,
        baseUrl: r.baseUrl,
        apiKey: r.apiKey,
        kind: (r.kind as RemoteModelKind) ?? null,
      }));
      // 合并三来源：本地候选名 + 表内远端条目 + 遗留(尚未迁表)的远端对象
      cfg.extraModels = [
        ...split.localNames.map((n) => ({
          name: n,
          baseUrl: null,
          apiKey: null,
          kind: null as RemoteModelKind | null,
        })),
        ...remoteEntries,
        ...split.remoteEntries,
      ];
      if (row.apiKey) cfg.apiKey = row.apiKey;
      if (row.temperature != null) cfg.temperature = row.temperature;
      // temperatureByTask 是 Json 字段，prisma generate 后类型会自动包含；先用 any 绕过
      const raw = row as Record<string, unknown>;
      if (raw.temperatureByTask)
        cfg.temperatureByTask = raw.temperatureByTask as Record<
          TaskType,
          number
        >;
      if (row.maxTokens != null) cfg.maxTokens = row.maxTokens;
    }
  } catch {
    // 数据库不可用 —— 回落到环境变量里的默认值
  }

  if (override) {
    if (override.provider) cfg.provider = override.provider;
    if (override.baseUrl) cfg.baseUrl = override.baseUrl;
    if (override.model) {
      cfg.model = override.model;
      // 工坊 / 设置页按名字切换模型：命中带独立连接参数的候选条目时改走该条目
      const entry = cfg.extraModels?.find(
        (e) => e.name === override.model && !!(e.baseUrl ?? e.apiKey),
      );
      if (entry) {
        if (entry.baseUrl) cfg.baseUrl = entry.baseUrl;
        if (entry.apiKey) cfg.apiKey = entry.apiKey;
      }
    }
    cfg.temperature = resolveTaskTemperature({
      taskType: override.taskType,
      explicitTemperature: override.temperature,
      overrides: cfg.temperatureByTask ?? null,
      fallback: cfg.temperature,
    });
    if (override.maxTokens != null) cfg.maxTokens = override.maxTokens;
  }

  return cfg;
}

/**
 * option C 的存量迁移（幂等）：把历史遗留、混在 llmConfig.extraModels 里的远端
 * 条目对象搬到独立 remoteModel 表，并把 llmConfig.extraModels 收窄成纯本地候选名。
 * 在 configGet / configSave 读配置前调用一次即可；已迁移后再次调用是空操作。
 */
export async function ensureRemoteStorageMigrated(): Promise<void> {
  const row = await llmConfigRepository.findSingleton();
  if (!row) return;
  const raw = (row as Record<string, unknown>).extraModels;
  if (!Array.isArray(raw)) return;
  const split = splitExtraModels(raw);
  if (split.remoteEntries.length === 0) return; // 无遗留远端条目，无需迁移
  // 迁移前先做本地/远端归并：历史对象形态里指向本机回环、且不带 apiKey 的条目是
  // 「误存的本地 ollama」，应折回本地候选，绝不能搬进 remoteModel 表当远端 —— 否则
  // 工坊下拉会把本机 ollama 挂成「远端」小标。
  const folded = foldRemoteToLocal(
    split.remoteEntries,
    split.localNames,
    row.baseUrl,
  );
  await remoteModelRepository.replaceAll(folded.remoteEntries);
  await llmConfigRepository.upsertSingleton({
    extraModels: folded.localNames,
  });
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
    const split = splitExtraModels(
      (row as Record<string, unknown>).extraModels,
    );
    const remoteRows = await remoteModelRepository.list();
    const tableEntries: RemoteModelEntry[] = remoteRows.map((r) => ({
      name: r.name,
      baseUrl: r.baseUrl,
      apiKey: r.apiKey,
      kind: (r.kind as RemoteModelKind) ?? null,
    }));
    // 读取层兜底归并：即便 remoteModel 表里还残留误存的本地 ollama（本地回环 +
    // 无 apiKey，历史迁移/误配置带入），也折回本地候选字符串下发 —— 工坊下拉与设置页
    // 因此不会再把它挂「远端」小标。
    const folded = foldRemoteToLocal(
      [...tableEntries, ...split.remoteEntries],
      split.localNames,
      row.baseUrl,
    );
    extra = [...folded.localNames, ...folded.remoteEntries];
  }
  return { ...cfg, extraModels: extra };
}

function headersFor(cfg: LLMConfig): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (cfg.provider === "remote" && cfg.apiKey) {
    h.Authorization = `Bearer ${cfg.apiKey}`;
  }
  return h;
}

/** 把 Node fetch 的网络层 TypeError（如 `fetch failed`）翻译成可操作的人话。
 *  历史 bug：Ollama 未启动 / 远端不可达时，用户只看到一句 `fetch failed`，
 *  既不知道是连不上本地 Ollama 还是远端 Key 无效，也没提示怎么处理。 */
export function describeFetchFailure(e: unknown, cfg: LLMConfig): string {
  /* 非 TypeError（未预期的抛值形态）：与全库同一个取值出口，
   * 免得 `String(e)` 那一路把非 Error 抛值渲染成 `[object Object]`。 */
  if (!(e instanceof TypeError)) return errorMessage(e, "网络请求失败");
  const cause = (e as { cause?: unknown }).cause;
  const causeMsg =
    cause instanceof Error
      ? String(cause.message)
      : cause != null
        ? typeof cause === "string"
          ? cause
          : (JSON.stringify(cause) ?? "")
        : "";
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

/** 统一的上游 /chat/completions 请求：网络层失败给出可读原因，HTTP 非 2xx 带状态码与响应片段。 */
async function upstreamChat(
  cfg: LLMConfig,
  body: Record<string, unknown>,
): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(`${cfg.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: headersFor(cfg),
      body: JSON.stringify(body),
    });
  } catch (e) {
    throw new Error(describeFetchFailure(e, cfg));
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    // 401/403 大概率是 Key 无效 / 未授权 —— 给个更明确的提示，而不是只给状态码。
    const hint =
      res.status === 401 || res.status === 403
        ? "（API Key 无效或未授权，请检查后重试）"
        : "";
    const snippet = detail.trim() ? `：${detail.slice(0, 200)}` : "";
    throw new Error(`LLM 请求失败 (${res.status})${hint}${snippet}`);
  }
  return res;
}

/** 模型未配置（空）时给调用方的统一出口文案 —— 不再兜底默认模型，
 *  避免用空的 model 打到后端拿一个「model not found」的含糊错误。 */
const ERR_MODEL_UNCONFIGURED =
  "尚未配置生效模型：请先在「设置 → 本地模型/远程模型」中选择或填写要使用的模型名";

function assertModelConfigured(cfg: LLMConfig): void {
  if (!cfg.model?.trim()) throw new Error(ERR_MODEL_UNCONFIGURED);
}

/* 一次性（非流式）补全。 */
export async function completeLLM(
  cfg: LLMConfig,
  messages: LLMMessage[],
): Promise<string> {
  assertModelConfigured(cfg);
  const res = await upstreamChat(cfg, {
    model: cfg.model,
    messages,
    temperature: cfg.temperature,
    max_tokens: cfg.maxTokens,
    stream: false,
  });

  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return json.choices?.[0]?.message?.content ?? "";
}

/* 流式补全。每收到一个增量就调用一次 `onToken`，
 * 最终以「拼接好的完整文本」resolve。
 * 兼容 Ollama、LM Studio、vLLM 与 OpenAI —— 它们发出的 SSE 分片形状一致，
 * 都形如 `{ choices: [{ delta: { content } }] }`。
 */
export async function streamLLM(
  cfg: LLMConfig,
  messages: LLMMessage[],
  onToken: (token: string) => void,
): Promise<string> {
  assertModelConfigured(cfg);
  const res = await upstreamChat(cfg, {
    model: cfg.model,
    messages,
    temperature: cfg.temperature,
    max_tokens: cfg.maxTokens,
    stream: true,
  });
  if (!res.body) {
    throw new Error("LLM 服务未返回数据流，请重试");
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let full = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const data = trimmed.slice(5).trim();
      if (data === "[DONE]") continue;
      try {
        const json = JSON.parse(data) as {
          choices?: Array<{ delta?: { content?: string } }>;
        };
        const token: string = json.choices?.[0]?.delta?.content ?? "";
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
  messages: LLMMessage[],
  schema: ZodType<T>,
): Promise<T> {
  assertModelConfigured(cfg);
  const res = await upstreamChat(cfg, {
    model: cfg.model,
    messages,
    temperature: cfg.temperature,
    max_tokens: cfg.maxTokens,
    stream: false,
    response_format: { type: "json_object" },
  });

  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = json.choices?.[0]?.message?.content ?? "{}";
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
 */
export interface CompleteToolsResult {
  content: string;
  toolCalls: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
}

export async function completeLLMTools(
  cfg: LLMConfig,
  messages: LLMMessage[],
  tools: LLMTool[],
): Promise<CompleteToolsResult> {
  assertModelConfigured(cfg);
  const res = await upstreamChat(cfg, {
    model: cfg.model,
    messages,
    temperature: cfg.temperature,
    max_tokens: cfg.maxTokens,
    stream: false,
    tools,
  });

  const json = (await res.json()) as {
    choices?: Array<{
      message?: {
        content?: string | null;
        tool_calls?: Array<{
          id?: string;
          type?: string;
          function?: { name?: string; arguments?: string };
        }>;
      };
    }>;
  };
  const msg = json.choices?.[0]?.message;
  const content = msg?.content ?? "";
  const rawCalls = msg?.tool_calls ?? [];
  // 逐条显式判空（而非 filter 后依赖类型收窄）：不同 TS 版本对
  // filter 回调的类型谓词推断不一致，显式守卫在两种版本下都能收窄。
  const toolCalls = rawCalls.flatMap((call) => {
    const fn = call?.function;
    if (!call?.id || !fn?.name || typeof fn.arguments !== "string") return [];
    return [
      {
        id: call.id,
        type: "function" as const,
        function: { name: fn.name, arguments: fn.arguments },
      },
    ];
  });

  return { content, toolCalls };
}
